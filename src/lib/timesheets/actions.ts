"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { addIsoDays, localDateTimeToIso, startOfLocalDay } from "@/lib/format";
import { requireRole, requireUser } from "@/lib/auth/session";
import { notify } from "@/lib/notifications/deliver";
import type { ClockEvent, ClockEventType } from "@/lib/clock/state";
import { generateTimesheet } from "./generate";
import type { Database } from "@/types/database";

type TimesheetInsert = Database["public"]["Tables"]["timesheets"]["Insert"];

export interface TimesheetActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
  /** True when the caller must resubmit confirming a duplicate day. */
  needsConfirmation?: boolean;
  /**
   * Values echoed back so a rejected manual entry can restore itself.
   * Uncontrolled inputs reset to their defaults on re-render otherwise, and
   * a manager would silently save a different day than the one they were
   * warned about — the same trap `saveShift` documents.
   */
  values?: {
    propertyId?: string;
    userId?: string;
    workDate?: string;
    startTime?: string;
    endTime?: string;
    breakMinutes?: string;
    managerNote?: string;
  };
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

    // Half-open [from, until): local midnight on `fromDate` to local midnight
    // on the day after `toDate`. The offset must come from the timezone rather
    // than a hardcoded "+10:00", which is an hour out during AEDT — from
    // October to April that window started at 1am and ran an hour into the
    // following day, so the first hour of clock events went missing and an
    // hour of the next day was swept in.
    const from = startOfLocalDay(fromDate);
    const until = startOfLocalDay(addIsoDays(toDate, 1));

    const [eventRes, shiftRes, existingRes] = await Promise.all([
      admin
        .from("clock_events")
        .select("id, user_id, event_type, server_time, shift_id")
        .eq("property_id", propertyId)
        .gte("server_time", from)
        .lt("server_time", until)
        .order("server_time", { ascending: true }),
      admin
        .from("shifts")
        .select("id, user_id, starts_at, ends_at, shift_breaks ( duration_minutes, is_paid )")
        .eq("property_id", propertyId)
        .eq("status", "published")
        .is("archived_at", null)
        .gte("starts_at", from)
        .lt("starts_at", until),
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
/* Entering hours by hand                                              */
/* ------------------------------------------------------------------ */

const manualSchema = z.object({
  propertyId: z.string().uuid("Choose a property."),
  userId: z.string().uuid("Choose a staff member."),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date worked."),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Enter a start time."),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Enter a finish time."),
  breakMinutes: z.number().int().min(0).max(600),
  managerNote: z.string().trim().max(500).optional(),
  confirmDuplicate: z.boolean().optional(),
});

/** Round to cents-of-an-hour, the precision `paid_hours` stores. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Record hours by hand, for when the clock was not used.
 *
 * Motels need this constantly: someone works a shift on a phone with a flat
 * battery, covers at short notice before being rostered, or the tablet at
 * reception is down. Without it the only route to a timesheet is
 * `generateTimesheets`, which can only ever reflect what the clock captured.
 *
 * The entry lands as `submitted`, exactly where a generated one lands, so it
 * flows through the same review, approval and export path rather than
 * becoming a second kind of timesheet.
 *
 * Times are wall-clock at the property and are resolved through
 * `localDateTimeToIso`; a finish at or before the start is read as an
 * overnight shift ending the following day, which is how night audit is
 * actually worked.
 */
export async function createManualTimesheet(
  _prev: TimesheetActionState,
  formData: FormData,
): Promise<TimesheetActionState> {
  const user = await requireRole("manager");

  const breakRaw = formData.get("breakMinutes");
  const values = {
    propertyId: (formData.get("propertyId") as string) ?? "",
    userId: (formData.get("userId") as string) ?? "",
    workDate: (formData.get("workDate") as string) ?? "",
    startTime: (formData.get("startTime") as string) ?? "",
    endTime: (formData.get("endTime") as string) ?? "",
    breakMinutes: (breakRaw as string) ?? "",
    managerNote: (formData.get("managerNote") as string) ?? "",
  };

  const parsed = manualSchema.safeParse({
    propertyId: formData.get("propertyId"),
    userId: formData.get("userId"),
    workDate: formData.get("workDate"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    breakMinutes: breakRaw ? Number(breakRaw) : 0,
    managerNote: (formData.get("managerNote") as string) || undefined,
    confirmDuplicate: formData.get("confirmDuplicate") === "on",
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

  const startIso = localDateTimeToIso(`${input.workDate}T${input.startTime}`);
  // A finish at or before the start means the shift ran past midnight.
  const endsNextDay = input.endTime <= input.startTime;
  const endIso = localDateTimeToIso(
    `${endsNextDay ? addIsoDays(input.workDate, 1) : input.workDate}T${input.endTime}`,
  );

  const workedHours =
    (Date.parse(endIso) - Date.parse(startIso)) / 3_600_000 -
    input.breakMinutes / 60;

  if (workedHours <= 0) {
    return {
      fieldErrors: {
        breakMinutes: "The break is longer than the shift.",
      },
      error: "That leaves no paid time. Check the times and the break.",
      values,
    };
  }
  if (workedHours > 16) {
    return {
      fieldErrors: { endTime: "That is more than 16 hours." },
      error:
        "That is longer than any single shift should be. Check the finish time — for an overnight shift, enter the date it started.",
      values,
    };
  }

  try {
    const supabase = await createClient();

    // Warn once about a second entry for the same person and day, rather than
    // refusing: split shifts and second properties are both ordinary. The
    // unique index is (user_id, work_date, shift_id) and manual rows carry a
    // NULL shift_id, which Postgres treats as always distinct — so nothing
    // downstream would catch an accidental double entry.
    if (!input.confirmDuplicate) {
      const { data: existing } = await supabase
        .from("timesheets")
        .select("id")
        .eq("user_id", input.userId)
        .eq("work_date", input.workDate)
        .limit(1)
        .maybeSingle();

      if (existing) {
        return {
          needsConfirmation: true,
          values,
          error:
            "There is already a timesheet for this person on this date. Confirm below if you meant to add a second one.",
        };
      }
    }

    const { error } = await supabase.from("timesheets").insert({
      organisation_id: user.organisationId,
      property_id: input.propertyId,
      user_id: input.userId,
      shift_id: null,
      work_date: input.workDate,
      actual_start: startIso,
      actual_end: endIso,
      break_minutes: input.breakMinutes,
      paid_hours: round2(workedHours),
      // No rostered window to compare against, so there is no variance to
      // report. Leaving it null is honest; zero would read as "matched".
      variance_hours: null,
      is_no_show: false,
      status: "submitted" as const,
      pay_period_start: input.workDate,
      pay_period_end: endsNextDay
        ? addIsoDays(input.workDate, 1)
        : input.workDate,
      manager_note: input.managerNote ?? null,
      created_by: user.id,
    });

    if (error) return { error: `Could not save the hours: ${error.message}`, values };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly.", values };
  }

  revalidatePath("/manage/timesheets");
  revalidatePath("/timesheets");
  return {
    success: `Recorded ${round2(workedHours)} h for ${input.workDate}.`,
  };
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
