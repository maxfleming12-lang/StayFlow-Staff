"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/deliver";
import { requireRole, requireUser } from "@/lib/auth/session";
import { LEAVE_CATEGORIES, suggestedHours } from "./hours";

export interface LeaveActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

const submitSchema = z
  .object({
    // Validate against the actual enum rather than any string, so an
    // unknown category is a clear form error instead of a database error.
    category: z.enum(
      LEAVE_CATEGORIES.map((c) => c.value) as [string, ...string[]],
      { message: "Choose a leave type." },
    ),
    firstDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a first day."),
    lastDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a last day."),
    isPartialDay: z.boolean(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.lastDate >= v.firstDate, {
    path: ["lastDate"],
    message: "The last day cannot be before the first day.",
  })
  .refine((v) => !v.isPartialDay || (v.startTime && v.endTime), {
    path: ["startTime"],
    message: "Partial-day leave needs a start and finish time.",
  })
  .refine(
    (v) =>
      !v.isPartialDay ||
      !v.startTime ||
      !v.endTime ||
      v.endTime > v.startTime,
    { path: ["endTime"], message: "The finish time must be after the start." },
  )
  .refine((v) => !v.isPartialDay || v.firstDate === v.lastDate, {
    path: ["lastDate"],
    message: "Partial-day leave applies to a single day.",
  });

/**
 * Submit a leave request.
 *
 * Always created as `pending`. RLS enforces that too — the insert policy
 * requires `status = 'pending'`, so a crafted request cannot arrive
 * pre-approved.
 */
export async function submitLeave(
  _prev: LeaveActionState,
  formData: FormData,
): Promise<LeaveActionState> {
  const user = await requireUser();

  const raw = {
    category: String(formData.get("category") ?? ""),
    firstDate: String(formData.get("firstDate") ?? ""),
    lastDate: String(formData.get("lastDate") ?? ""),
    isPartialDay: formData.get("isPartialDay") === "on",
    startTime: (formData.get("startTime") as string) || undefined,
    endTime: (formData.get("endTime") as string) || undefined,
    note: (formData.get("note") as string) || undefined,
  };

  // Echoed back so a rejected submission does not clear the form.
  const values: Record<string, string> = {
    category: raw.category,
    firstDate: raw.firstDate,
    lastDate: raw.lastDate,
    isPartialDay: raw.isPartialDay ? "on" : "",
    startTime: raw.startTime ?? "",
    endTime: raw.endTime ?? "",
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
    const { error } = await supabase.from("leave_requests").insert({
      organisation_id: user.organisationId,
      property_id: user.primaryPropertyId ?? null,
      user_id: user.id,
      category: input.category as (typeof LEAVE_CATEGORIES)[number]["value"],
      first_date: input.firstDate,
      last_date: input.lastDate,
      is_partial_day: input.isPartialDay,
      start_time: input.isPartialDay ? input.startTime : null,
      end_time: input.isPartialDay ? input.endTime : null,
      total_hours: suggestedHours({
        firstDate: input.firstDate,
        lastDate: input.lastDate,
        isPartialDay: input.isPartialDay,
        startTime: input.startTime,
        endTime: input.endTime,
      }),
      note: input.note ?? null,
      status: "pending",
      created_by: user.id,
    });

    if (error) return { error: `Could not submit: ${error.message}`, values };
  } catch {
    return {
      error: "Cannot reach StayFlow right now. Try again when you have signal.",
      values,
    };
  }

  revalidatePath("/leave");
  revalidatePath("/manage/leave");
  return { success: "Leave request submitted. Your manager will review it." };
}

/** Withdraw a pending request. RLS allows this only while pending. */
export async function cancelLeave(id: string): Promise<LeaveActionState> {
  await requireUser();
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("leave_requests")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("status", "pending");
    if (error) return { error: "Could not withdraw the request." };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }
  revalidatePath("/leave");
  return { success: "Leave request withdrawn." };
}

const decideSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "declined"]),
  managerNote: z.string().trim().max(1000).optional(),
});

/**
 * Approve or decline a leave request.
 *
 * A manager cannot decide their own request: `guard_leave_self_approval`
 * blocks it in the database, so this is enforced even if a future caller
 * forgets. Approving does NOT remove conflicting shifts — the manager sees
 * them on screen and decides what to do, because silently unrostering
 * someone would leave the shift uncovered with nobody told.
 */
export async function decideLeave(
  _prev: LeaveActionState,
  formData: FormData,
): Promise<LeaveActionState> {
  const user = await requireRole("manager");

  const parsed = decideSchema.safeParse({
    id: formData.get("id"),
    decision: formData.get("decision"),
    managerNote: (formData.get("managerNote") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: "That request could not be identified." };
  }

  const { id, decision, managerNote } = parsed.data;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("leave_requests")
      .update({
        status: decision,
        manager_note: managerNote ?? null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("user_id, first_date, last_date, organisation_id, property_id")
      .maybeSingle();

    if (error) {
      // The self-approval guard raises rather than silently matching no rows.
      return { error: error.message };
    }
    if (!data) {
      return { error: "That request is no longer available to decide." };
    }

    // notify() records the row AND pushes it, respecting the person's
    // preferences and quiet hours. No dates, reasons or medical detail in
    // the body — this can appear on a lock screen.
    const { error: notifyError } = await notify({
      organisationId: data.organisation_id,
      propertyId: data.property_id,
      userIds: [data.user_id],
      category: "leave_update",
      title: decision === "approved" ? "Leave approved" : "Leave declined",
      body:
        decision === "approved"
          ? "Your leave request has been approved."
          : "Your leave request was declined. Open StayFlow for details.",
      deepLink: "/leave",
    });

    revalidatePath("/manage/leave");
    revalidatePath("/leave");

    if (notifyError) {
      return {
        success: `Leave ${decision}, but the staff member could not be notified: ${notifyError}`,
      };
    }
    return { success: `Leave ${decision}.` };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }
}
