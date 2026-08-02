"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth/session";
import { localDateTimeToIso } from "@/lib/format";
import { notify } from "@/lib/notifications/deliver";
import {
  ANNOUNCEMENT_CATEGORIES,
  canTransition,
  notificationCategoryFor,
  type AnnouncementStatus,
} from "./status";

export interface AnnouncementActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

const createSchema = z.object({
  title: z.string().trim().min(1, "Give the notice a title.").max(200),
  body: z.string().trim().min(1, "Write the notice.").max(5000),
  category: z.enum(ANNOUNCEMENT_CATEGORIES),
  isUrgent: z.boolean(),
  requiresAck: z.boolean(),
  audience: z.enum(["all", "property"]),
  propertyId: z.string().uuid().optional(),
  expiresAt: z.string().optional(),
});

/**
 * Post a notice.
 *
 * Published immediately rather than saved as a draft. A motel notice is
 * written because something needs saying now; a draft workflow is a step
 * that exists to be forgotten. Taking one down is `withdrawAnnouncement`,
 * which keeps the record of what was said.
 */
export async function createAnnouncement(
  _prev: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const user = await requireRole("manager");

  const values: Record<string, string> = {
    title: (formData.get("title") as string) ?? "",
    body: (formData.get("body") as string) ?? "",
    category: (formData.get("category") as string) ?? "general",
    audience: (formData.get("audience") as string) ?? "all",
    propertyId: (formData.get("propertyId") as string) ?? "",
    expiresAt: (formData.get("expiresAt") as string) ?? "",
  };

  const parsed = createSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    category: (formData.get("category") as string) || "general",
    isUrgent: formData.get("isUrgent") === "on",
    requiresAck: formData.get("requiresAck") === "on",
    audience: (formData.get("audience") as string) || "all",
    propertyId: (formData.get("propertyId") as string) || undefined,
    expiresAt: (formData.get("expiresAt") as string) || undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors, error: "Check the highlighted fields.", values };
  }

  const input = parsed.data;

  if (input.audience === "property" && !input.propertyId) {
    return {
      fieldErrors: { propertyId: "Choose which property." },
      error: "Choose which property this is for.",
      values,
    };
  }

  let expiresIso: string | null = null;
  if (input.expiresAt) {
    try {
      expiresIso = localDateTimeToIso(input.expiresAt);
    } catch {
      return {
        fieldErrors: { expiresAt: "Enter an expiry as a date and time." },
        error: "Check the expiry.",
        values,
      };
    }
  }

  const now = new Date().toISOString();

  try {
    const supabase = await createClient();

    const { data: announcement, error } = await supabase
      .from("announcements")
      .insert({
        organisation_id: user.organisationId,
        property_id: input.audience === "property" ? input.propertyId! : null,
        title: input.title,
        body: input.body,
        category: input.category,
        is_urgent: input.isUrgent,
        requires_ack: input.requiresAck,
        status: "published" as const,
        published_at: now,
        published_by: user.id,
        expires_at: expiresIso,
        created_by: user.id,
      })
      .select("id")
      .maybeSingle();

    if (error || !announcement) {
      return { error: `Could not post that notice: ${error?.message ?? ""}`, values };
    }

    // Targeting is a separate table, and the notice is invisible without a
    // row here — `announcements_select_targeted` requires one. A failure
    // must be reported rather than leaving a notice nobody can see.
    const { error: targetError } = await supabase
      .from("announcement_recipients")
      .insert({
        organisation_id: user.organisationId,
        announcement_id: announcement.id,
        all_staff: input.audience === "all",
        property_id: input.audience === "property" ? input.propertyId! : null,
      });

    if (targetError) {
      return {
        error:
          "The notice was saved but could not be aimed at anybody, so nobody can see it. Withdraw it and post again.",
        values,
      };
    }

    // An urgent notice goes out under a category that ignores quiet hours.
    // That is the whole point of the flag.
    await notify({
      organisationId: user.organisationId,
      propertyId: input.audience === "property" ? input.propertyId! : undefined,
      userIds: await recipientUserIds(
        supabase,
        user.organisationId,
        input.audience === "property" ? input.propertyId! : null,
      ),
      category: notificationCategoryFor(input.isUrgent),
      title: input.isUrgent ? "Urgent notice" : "New notice",
      // The title of the notice itself is not repeated: it can appear on a
      // locked phone and a manager does not choose it with that in mind.
      body: "A notice has been posted. Open StayFlow to read it.",
      deepLink: "/announcements",
    });
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly.", values };
  }

  revalidatePath("/announcements");
  return { success: "Notice posted." };
}

/**
 * Active staff who should be told, by property or across the organisation.
 *
 * BOTH audiences are filtered to active, non-archived profiles in this
 * organisation. Property used to be read straight off
 * `user_property_access`, which deactivating somebody does not touch — it
 * only flips `profiles.is_active` — so a former employee with the app still
 * installed kept receiving notices for their old motel, while an all-staff
 * notice correctly skipped them.
 */
async function recipientUserIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organisationId: string,
  propertyId: string | null,
): Promise<string[]> {
  let restrictTo: string[] | null = null;

  if (propertyId) {
    const { data: access } = await supabase
      .from("user_property_access")
      .select("user_id")
      .eq("organisation_id", organisationId)
      .eq("property_id", propertyId);

    restrictTo = [...new Set((access ?? []).map((row) => String(row.user_id)))];
    // Nobody has access, so nobody is told. Falling through with an empty
    // list would drop the narrowing and notify the whole organisation.
    if (restrictTo.length === 0) return [];
  }

  let query = supabase
    .from("profiles")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("is_active", true)
    .is("archived_at", null);

  if (restrictTo) query = query.in("id", restrictTo);

  const { data } = await query;
  return (data ?? []).map((row) => String(row.id));
}

const withdrawSchema = z.object({ id: z.string().uuid() });

/**
 * Take a notice down.
 *
 * Withdrawn, never deleted: what staff were told, and when, is exactly the
 * thing worth keeping.
 */
export async function withdrawAnnouncement(
  _prev: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  await requireRole("manager");

  const parsed = withdrawSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "That notice could not be identified." };

  try {
    const supabase = await createClient();

    const { data: current, error: readError } = await supabase
      .from("announcements")
      .select("id, status")
      .eq("id", parsed.data.id)
      .is("archived_at", null)
      .maybeSingle();

    if (readError) return { error: "Could not read that notice." };
    if (!current) return { error: "That notice is no longer available." };

    const from = String(current.status) as AnnouncementStatus;
    if (!canTransition(from, "withdrawn")) {
      return { error: "That notice has already been withdrawn." };
    }

    const { data, error } = await supabase
      .from("announcements")
      .update({ status: "withdrawn" as const })
      .eq("id", parsed.data.id)
      // Repeated in the write so two managers cannot both withdraw it.
      .eq("status", from)
      .select("id")
      .maybeSingle();

    if (error) return { error: error.message };
    if (!data) return { error: "Somebody else changed that notice just now." };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }

  revalidatePath("/announcements");
  return { success: "Notice withdrawn. Staff can no longer see it." };
}

const ackSchema = z.object({ id: z.string().uuid() });

/** Record that the caller has read and acknowledged a notice. */
export async function acknowledgeAnnouncement(
  _prev: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const user = await requireUser();

  const parsed = ackSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "That notice could not be identified." };

  const now = new Date().toISOString();

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("announcement_acknowledgements")
      .upsert(
        {
          organisation_id: user.organisationId,
          announcement_id: parsed.data.id,
          user_id: user.id,
          read_at: now,
          acknowledged_at: now,
        },
        { onConflict: "announcement_id,user_id" },
      );

    if (error) return { error: "Could not record that." };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }

  revalidatePath("/announcements");
  return { success: "Thanks — your manager can see you have read this." };
}
