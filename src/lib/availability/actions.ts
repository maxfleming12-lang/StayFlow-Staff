"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth/session";

export interface AvailabilityActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

const submitSchema = z
  .object({
    kind: z.enum(["recurring", "date"]),
    dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
    specificDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.")
      .optional(),
    allDay: z.boolean(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    isAvailable: z.boolean(),
    note: z.string().trim().max(500).optional(),
  })
  // The database enforces exactly one of day_of_week / specific_date; mirror
  // it here so the staff member gets a form error rather than a 500.
  .refine((v) => (v.kind === "recurring" ? v.dayOfWeek != null : true), {
    path: ["dayOfWeek"],
    message: "Choose a day of the week.",
  })
  .refine((v) => (v.kind === "date" ? Boolean(v.specificDate) : true), {
    path: ["specificDate"],
    message: "Choose a date.",
  })
  .refine((v) => v.allDay || (v.startTime && v.endTime), {
    path: ["startTime"],
    message: "Give a start and finish time, or choose all day.",
  })
  .refine(
    (v) => v.allDay || !v.startTime || !v.endTime || v.endTime > v.startTime,
    { path: ["endTime"], message: "The finish time must be after the start." },
  );

/**
 * Submit an availability rule.
 *
 * Always `pending`. The RLS insert policy requires it, so a crafted request
 * cannot arrive pre-approved.
 */
export async function submitAvailability(
  _prev: AvailabilityActionState,
  formData: FormData,
): Promise<AvailabilityActionState> {
  const user = await requireUser();

  const raw = {
    kind: (formData.get("kind") as string) === "date" ? "date" : "recurring",
    dayOfWeek: (formData.get("dayOfWeek") as string) || undefined,
    specificDate: (formData.get("specificDate") as string) || undefined,
    allDay: formData.get("allDay") === "on",
    startTime: (formData.get("startTime") as string) || undefined,
    endTime: (formData.get("endTime") as string) || undefined,
    // The form asks "are you available?" as a positive, because a double
    // negative ("tick to mark unavailable") is easy to misread.
    isAvailable: formData.get("isAvailable") === "on",
    note: (formData.get("note") as string) || undefined,
  };

  const values: Record<string, string> = {
    kind: raw.kind,
    dayOfWeek: raw.dayOfWeek ?? "",
    specificDate: raw.specificDate ?? "",
    allDay: raw.allDay ? "on" : "",
    startTime: raw.startTime ?? "",
    endTime: raw.endTime ?? "",
    isAvailable: raw.isAvailable ? "on" : "",
    note: raw.note ?? "",
  };

  const parsed = submitSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors, values };
  }

  const input = parsed.data;

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("staff_availability").insert({
      organisation_id: user.organisationId,
      user_id: user.id,
      day_of_week: input.kind === "recurring" ? (input.dayOfWeek ?? null) : null,
      specific_date: input.kind === "date" ? (input.specificDate ?? null) : null,
      start_time: input.allDay ? null : (input.startTime ?? null),
      end_time: input.allDay ? null : (input.endTime ?? null),
      is_available: input.isAvailable,
      note: input.note ?? null,
      status: "pending",
    });

    if (error) return { error: `Could not submit: ${error.message}`, values };
  } catch {
    return {
      error: "Cannot reach StayFlow right now. Try again when you have signal.",
      values,
    };
  }

  revalidatePath("/availability");
  revalidatePath("/manage/availability");
  return {
    success: "Availability submitted. Your manager will review it.",
  };
}

/** Withdraw a pending rule. RLS permits this only while pending. */
export async function withdrawAvailability(
  id: string,
): Promise<AvailabilityActionState> {
  await requireUser();
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("staff_availability")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending");
    if (error) return { error: "Could not withdraw that." };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }
  revalidatePath("/availability");
  return { success: "Withdrawn." };
}

const decideSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "declined"]),
  reviewNote: z.string().trim().max(500).optional(),
});

/**
 * Approve or decline an availability submission.
 *
 * Approval matters beyond bookkeeping: the roster conflict engine only
 * consults APPROVED availability, so an unreviewed submission warns nobody.
 */
export async function decideAvailability(
  _prev: AvailabilityActionState,
  formData: FormData,
): Promise<AvailabilityActionState> {
  const user = await requireRole("manager");

  const parsed = decideSchema.safeParse({
    id: formData.get("id"),
    decision: formData.get("decision"),
    reviewNote: (formData.get("reviewNote") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: "That submission could not be identified." };
  }

  const { id, decision, reviewNote } = parsed.data;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("staff_availability")
      .update({
        status: decision,
        review_note: reviewNote ?? null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("user_id, organisation_id")
      .maybeSingle();

    if (error) return { error: error.message };
    if (!data) {
      return { error: "That submission is no longer available to decide." };
    }

    // No INSERT policy on notifications by design, so the system writes it.
    const admin = createServiceRoleClient();
    const { error: notifyError } = await admin.from("notifications").insert({
      organisation_id: data.organisation_id,
      user_id: data.user_id,
      category: "availability_update" as const,
      title:
        decision === "approved"
          ? "Availability approved"
          : "Availability declined",
      body:
        decision === "approved"
          ? "Your availability update has been approved."
          : "Your availability update was not approved. Open StayFlow for details.",
      deep_link: "/availability",
    });

    revalidatePath("/manage/availability");
    revalidatePath("/availability");

    if (notifyError) {
      return {
        success: `Availability ${decision}, but the staff member could not be notified: ${notifyError.message}`,
      };
    }
    return { success: `Availability ${decision}.` };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }
}
