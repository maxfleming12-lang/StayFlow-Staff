"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth/session";
import { notify } from "@/lib/notifications/deliver";
import type { ClockEvent, ClockEventType } from "@/lib/clock/state";
import { generateTimesheet } from "./generate";
import type { Database } from "@/types/database";

type TimesheetInsert = Database["public"]["Tables"]["timesheets"]["Insert"];

export interface TimesheetActionState {
  error?: string;
  success?: string;
}

/* ------------------------------------------------------------------ */
/* Generating timesheets from clock events                             */
/* ------------------------------------------------------------------ */

const generateSchema = z.object({
  propertyId: z.string().uuid("Choose a property."),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Build draft timesheets from clock events for a date range.
 *
 * Written with the service-role client because it reads every staff
 * member's clock events for a property, which no single user may do. The
 * caller is already verified as a manager for that property.
 *
 * Existing timesheets are NOT overwritten. Once a manager has touched a
 * timesheet — let alone approved one — regenerating it from raw events
 * would silently discard their correction.
 */
export async function generateTimesheets(
  _prev: TimesheetActionState,
  formData: FormData,
): Promise<TimesheetActionState> {
  const user = await requireRole("manager");

  const parsed = generateSchema.safeParse({
    propertyId: formData.get("propertyId"),
    fromDate: formData.get("fromDate"),
    toDate: formData.get("toDate"),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { propertyId, fromDate, toDate } = parsed.data;
  if (toDate < fromDate) {
    return { error: "The end date cannot be before the start date." };
  }

  try {
    const admin = createServiceRoleClient();
    const from = new Date(`${fromDate}T00:00:00+10:00`);
    const to = new Date(`${toDate}T23:59:59+10:00`);

    const [eventRes, shiftRes, existingRes] = await Promise.all([
      admin
        .from("clock_events")
        .select("id, user_id, event_type, server_time, shift_id")
        .eq("property_id", propertyId)
        .gte("server_time", from.toISOString())
        .lte("server_time", to.toISOString())
        .order("server_time", { ascending: true }),
      admin
        .from("shifts")
        .select("id, user_id, starts_at, ends_at, shift_breaks ( duration_minutes, is_paid )")
        .eq("property_id", propertyId)
        .eq("status", "published")
        .is("archived_at", null)
        .gte("starts_at", from.toISOString())
        .lte("starts_at", to.toISOString()),
      admin
        .from("timesheets")
        .select("user_id, work_date")
        .eq("property_id", propertyId)
        .gte("work_date", fromDate)
        .lte("work_date", toDate),
    ]);

    if (eventRes.error) return { error: `Could not read attendance: ${eventRes.error.message}` };

    const dayKey = (iso: string) =>
      new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: "Australia/Sydney",
      }).format(new Date(iso));

    // Group events by person and local day.
    const byPersonDay = new Map<string, ClockEvent[]>();
    for (const row of eventRes.data ?? []) {
      const key = `${row.user_id}|${dayKey(String(row.server_time))}`;
      const list = byPersonDay.get(key) ?? [];
      list.push({
        id: String(row.id),
        eventType: String(row.event_type) as ClockEventType,
        serverTime: String(row.server_time),
        shiftId: (row.shift_id as string | null) ?? null,
      });
      byPersonDay.set(key, list);
    }

    // Index rostered shifts the same way, so a no-show still gets a row.
    const shiftByPersonDay = new Map<
      string,
      { id: string; startsAt: string; endsAt: string; unpaidBreakMinutes: number }
    >();
    for (const shift of shiftRes.data ?? []) {
      if (!shift.user_id) continue;
      const breaks = Array.isArray(shift.shift_breaks) ? shift.shift_breaks : [];
      const unpaid = breaks
        .filter((b) => !(b as Record<string, unknown>).is_paid)
        .reduce(
          (t, b) => t + Number((b as Record<string, unknown>).duration_minutes ?? 0),
          0,
        );
      shiftByPersonDay.set(`${shift.user_id}|${dayKey(String(shift.starts_at))}`, {
        id: String(shift.id),
        startsAt: String(shift.starts_at),
        endsAt: String(shift.ends_at),
        unpaidBreakMinutes: unpaid,
      });
    }

    const alreadyThere = new Set(
      (existingRes.data ?? []).map((t) => `${t.user_id}|${t.work_date}`),
    );

    const keys = new Set([...byPersonDay.keys(), ...shiftByPersonDay.keys()]);
    const rows: TimesheetInsert[] = [];

    for (const key of keys) {
      if (alreadyThere.has(key)) continue;

      const [userId, workDate] = key.split("|");
      const events = byPersonDay.get(key) ?? [];
      const shift = shiftByPersonDay.get(key) ?? null;
      const generated = generateTimesheet(events, shift);

      rows.push({
        organisation_id: user.organisationId,
        property_id: propertyId,
        user_id: userId,
        shift_id: shift?.id ?? null,
        work_date: workDate,
        rostered_start: shift?.startsAt ?? null,
        rostered_end: shift?.endsAt ?? null,
        actual_start: generated.actualStart,
        actual_end: generated.actualEnd,
        break_minutes: generated.breakMinutes,
        paid_hours: generated.paidHours,
        variance_hours: generated.varianceHours,
        is_no_show: generated.isNoShow,
        status: "submitted" as const,
        pay_period_start: fromDate,
        pay_period_end: toDate,
        created_by: user.id,
      });
    }

    if (rows.length === 0) {
      return {
        success:
          "Nothing new to build — every day in that range already has a timesheet.",
      };
    }

    const { error } = await admin.from("timesheets").insert(rows);
    if (error) return { error: `Could not build timesheets: ${error.message}` };

    revalidatePath("/manage/timesheets");
    revalidatePath("/timesheets");
    return {
      success: `Built ${rows.length} timesheet${rows.length === 1 ? "" : "s"} from recorded attendance.`,
    };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }
}

/* ------------------------------------------------------------------ */
/* Staff: acknowledge, or ask for a correction                         */
/* ------------------------------------------------------------------ */

const ackSchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});

/**
 * Confirm your recorded hours look right.
 *
 * `guard_timesheet_staff_update` allows staff exactly two columns —
 * staff_note and staff_acknowledged_at — so this cannot alter the hours
 * even if it tried.
 */
export async function acknowledgeTimesheet(
  _prev: TimesheetActionState,
  formData: FormData,
): Promise<TimesheetActionState> {
  await requireUser();

  const parsed = ackSchema.safeParse({
    id: formData.get("id"),
    note: (formData.get("note") as string) || undefined,
  });
  if (!parsed.success) return { error: "That timesheet could not be identified." };

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("timesheets")
      .update({
        staff_acknowledged_at: new Date().toISOString(),
        staff_note: parsed.data.note ?? null,
      })
      .eq("id", parsed.data.id);

    if (error) return { error: error.message };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }

  revalidatePath("/timesheets");
  return { success: "Thanks — your manager can see you have checked these." };
}

const correctionSchema = z.object({
  timesheetId: z.string().uuid(),
  requestedStart: z.string().optional(),
  requestedEnd: z.string().optional(),
  requestedBreakMinutes: z.coerce.number().int().min(0).max(600).optional(),
  explanation: z
    .string()
    .trim()
    .min(10, "Explain what was wrong so your manager can check it.")
    .max(1000),
});

/**
 * Ask for a correction to recorded hours.
 *
 * A correction is a REQUEST, not an edit. Attendance events are append-only
 * and staff cannot change their own hours, so this creates a record for a
 * manager to act on — leaving the original exactly as recorded.
 */
export async function requestCorrection(
  _prev: TimesheetActionState,
  formData: FormData,
): Promise<TimesheetActionState> {
  const user = await requireUser();

  const parsed = correctionSchema.safeParse({
    timesheetId: formData.get("timesheetId"),
    requestedStart: (formData.get("requestedStart") as string) || undefined,
    requestedEnd: (formData.get("requestedEnd") as string) || undefined,
    requestedBreakMinutes: formData.get("requestedBreakMinutes") || undefined,
    explanation: formData.get("explanation"),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const supabase = await createClient();

    const { data: sheet } = await supabase
      .from("timesheets")
      .select("id, work_date, status")
      .eq("id", parsed.data.timesheetId)
      .maybeSingle();

    if (!sheet) return { error: "That timesheet is no longer available." };

    const { error } = await supabase
      .from("timesheet_adjustment_requests")
      .insert({
        organisation_id: user.organisationId,
        timesheet_id: parsed.data.timesheetId,
        user_id: user.id,
        requested_date: sheet.work_date,
        requested_start: parsed.data.requestedStart || null,
        requested_end: parsed.data.requestedEnd || null,
        requested_break_minutes: parsed.data.requestedBreakMinutes ?? null,
        explanation: parsed.data.explanation,
        status: "open",
      });

    if (error) return { error: `Could not send that: ${error.message}` };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }

  revalidatePath("/timesheets");
  revalidatePath("/manage/timesheets");
  return {
    success:
      "Correction requested. Your hours stay as recorded until your manager reviews it.",
  };
}

/* ------------------------------------------------------------------ */
/* Manager: approve                                                    */
/* ------------------------------------------------------------------ */

const approveSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  managerNote: z.string().trim().max(500).optional(),
});

/**
 * Approve timesheets.
 *
 * `guard_timesheet_management` independently blocks approving your own
 * timesheet, stamping somebody else as approver, and touching a locked row,
 * so this action does not re-implement those rules.
 */
export async function approveTimesheets(
  _prev: TimesheetActionState,
  formData: FormData,
): Promise<TimesheetActionState> {
  const user = await requireRole("manager");

  const parsed = approveSchema.safeParse({
    ids: formData.getAll("ids").map(String).filter(Boolean),
    managerNote: (formData.get("managerNote") as string) || undefined,
  });

  if (!parsed.success) return { error: "Select at least one timesheet." };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("timesheets")
      .update({
        status: "approved",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        manager_note: parsed.data.managerNote ?? null,
      })
      .in("id", parsed.data.ids)
      .select("id, user_id, organisation_id");

    // The database guards raise rather than matching zero rows, so an error
    // here is the real reason and worth showing.
    if (error) return { error: error.message };
    if (!data || data.length === 0) {
      return { error: "None of those timesheets could be approved." };
    }

    await notify({
      organisationId: user.organisationId,
      userIds: data.map((d) => String(d.user_id)),
      category: "timesheet_correction",
      title: "Hours approved",
      body: "Your recorded hours have been approved. Open StayFlow to view them.",
      deepLink: "/timesheets",
    });

    revalidatePath("/manage/timesheets");
    revalidatePath("/timesheets");
    return {
      success: `Approved ${data.length} timesheet${data.length === 1 ? "" : "s"}.`,
    };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }
}
