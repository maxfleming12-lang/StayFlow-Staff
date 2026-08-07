"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  DEFAULT_TIMEZONE,
  addIsoDays,
  localDateTimeToIso,
  startOfLocalDay,
} from "@/lib/format";
import { requireRole, requireUser } from "@/lib/auth/session";
import { notify } from "@/lib/notifications/deliver";
import type { ClockEvent, ClockEventType } from "@/lib/clock/state";
import { generateTimesheet, rosteredHours } from "./generate";
import { MAX_ENTRY_HOURS, deriveHours, round2 } from "./entry";
import type { Database } from "@/types/database";

type TimesheetInsert = Database["public"]["Tables"]["timesheets"]["Insert"];
type TimesheetUpdate = Database["public"]["Tables"]["timesheets"]["Update"];

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
 * A timesheet somebody has TOUCHED is never overwritten — regenerating it
 * from raw events would silently discard a correction. An untouched one is
 * refreshed, and the difference matters more than it sounds:
 *
 * Generating a range that ran past today wrote a row for every rostered
 * shift that had not happened yet. With no attendance to draw on each was
 * recorded as a no-show — no start, no finish, zero paid hours, variance
 * short by the full rostered length. Skipping every existing row then meant
 * the real clock-in, when it came, could never reach the timesheet: the day
 * was frozen as "did not turn up" before it began, and staff would have been
 * paid nothing for shifts they worked.
 *
 * So: nothing is generated past today, and a row that is still plain
 * scaffolding is rebuilt rather than skipped.
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

  // Nothing is built past today, as the property reckons it.
  //
  // A shift that has not happened has no attendance, so it was written as a
  // no-show — and then frozen that way, because a row that exists is never
  // rebuilt from scratch. Tomorrow's roster became tomorrow's "did not turn
  // up" before anybody had the chance to turn up.
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: DEFAULT_TIMEZONE,
  }).format(new Date());

  if (fromDate > today) {
    return {
      error:
        "That range has not happened yet. Timesheets are built from attendance, so there is nothing to build.",
    };
  }

  // Quietly shortened rather than refused: picking the current week on a
  // Wednesday is the normal thing to do, and Monday to Wednesday is exactly
  // what the manager wants out of it. The message says where it stopped.
  const lastDate = toDate > today ? today : toDate;
  const shortened = lastDate !== toDate;

  try {
    const admin = createServiceRoleClient();

    // Half-open [from, until): local midnight on `fromDate` to local midnight
    // on the day after `lastDate`. The offset must come from the timezone
    // rather than a hardcoded "+10:00", which is an hour out during AEDT —
    // from October to April that window started at 1am and ran an hour into
    // the following day, so the first hour of clock events went missing and
    // an hour of the next day was swept in.
    const from = startOfLocalDay(fromDate);
    const until = startOfLocalDay(addIsoDays(lastDate, 1));

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
        .select(
          "id, user_id, work_date, status, manager_note, staff_acknowledged_at, actual_start, actual_end",
        )
        .eq("property_id", propertyId)
        .gte("work_date", fromDate)
        .lte("work_date", lastDate),
    ]);

    // All three must be checked, not just the events.
    //
    // A failed `existing` query leaves `alreadyThere` empty, and every day in
    // the range is then inserted afresh — duplicating timesheets that are
    // already there and defeating the "never overwrite a corrected sheet"
    // guarantee this function is built around. A failed `shifts` query loses
    // every rostered window, so a no-show gets no row at all and nothing has
    // a variance. Both used to pass silently and produce plausible, wrong
    // payroll.
    for (const [label, result] of [
      ["attendance", eventRes],
      ["the roster", shiftRes],
      ["existing timesheets", existingRes],
    ] as const) {
      if (result.error) {
        return { error: `Could not read ${label}: ${result.error.message}` };
      }
    }

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

    /**
     * Is this row still plain scaffolding?
     *
     * `submitted` with no attendance on it and nobody's fingerprints. Such a
     * row carries no information that rebuilding could destroy, and leaving
     * it alone is what stranded a real clock-in behind a no-show.
     *
     * The attendance test is what protects a MANUAL entry: those always
     * carry both times, so they are never in scope here however they were
     * worded. A part-finished row — clocked in, not yet out — is in scope,
     * because the missing half is the whole point of rebuilding it.
     *
     * Anything approved, exported, locked, acknowledged by staff or annotated
     * by a manager fails the first tests and is left exactly as it is.
     */
    const isScaffolding = (row: Record<string, unknown>) =>
      row.status === "submitted" &&
      row.manager_note == null &&
      row.staff_acknowledged_at == null &&
      (row.actual_start == null || row.actual_end == null);

    const existingByKey = new Map(
      (existingRes.data ?? []).map((t) => [
        `${t.user_id}|${t.work_date}`,
        t as Record<string, unknown>,
      ]),
    );

    const keys = new Set([...byPersonDay.keys(), ...shiftByPersonDay.keys()]);
    const rows: TimesheetInsert[] = [];
    const refreshes: { id: string; patch: TimesheetUpdate }[] = [];

    for (const key of keys) {
      const existing = existingByKey.get(key);
      if (existing && !isScaffolding(existing)) continue;

      const [userId, workDate] = key.split("|");
      const events = byPersonDay.get(key) ?? [];
      const shift = shiftByPersonDay.get(key) ?? null;
      const generated = generateTimesheet(events, shift);

      if (existing) {
        // Only what the clock and the roster decide. `status` is not touched,
        // so a rebuild cannot walk a sheet backwards through review, and
        // `created_by` keeps whoever first built it.
        refreshes.push({
          id: String(existing.id),
          patch: {
            shift_id: shift?.id ?? null,
            rostered_start: shift?.startsAt ?? null,
            rostered_end: shift?.endsAt ?? null,
            actual_start: generated.actualStart,
            actual_end: generated.actualEnd,
            break_minutes: generated.breakMinutes,
            paid_hours: generated.paidHours,
            variance_hours: generated.varianceHours,
            is_no_show: generated.isNoShow,
          },
        });
        continue;
      }

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
        pay_period_end: lastDate,
        created_by: user.id,
      });
    }

    const upTo = shortened ? ` Stopped at today (${lastDate}).` : "";

    if (rows.length === 0 && refreshes.length === 0) {
      return {
        success: `Nothing to do — every day in that range is already accounted for.${upTo}`,
      };
    }

    if (rows.length > 0) {
      const { error } = await admin.from("timesheets").insert(rows);
      if (error) return { error: `Could not build timesheets: ${error.message}` };
    }

    // One statement each, rather than an upsert. An upsert would have to
    // restate every column to satisfy the insert branch, and would overwrite
    // `created_by` on rows somebody else first built.
    const failed = (
      await Promise.all(
        refreshes.map(async ({ id, patch }) => {
          const { error } = await admin
            .from("timesheets")
            .update(patch)
            .eq("id", id)
            // Re-checked at the write. Between the read above and here, a
            // manager may have approved the very sheet being rebuilt.
            .eq("status", "submitted")
            .is("manager_note", null)
            .is("staff_acknowledged_at", null);
          return error ? id : null;
        }),
      )
    ).filter(Boolean);

    if (failed.length > 0) {
      return {
        error: `Built ${rows.length}, but ${failed.length} existing timesheet${failed.length === 1 ? "" : "s"} could not be updated. Check them by hand.`,
      };
    }

    revalidatePath("/manage/timesheets");
    revalidatePath("/timesheets");

    const built = rows.length
      ? `Built ${rows.length} timesheet${rows.length === 1 ? "" : "s"}`
      : "";
    const updated = refreshes.length
      ? `${built ? " and updated" : "Updated"} ${refreshes.length} that had no attendance on ${refreshes.length === 1 ? "it" : "them"} yet`
      : "";

    return { success: `${built}${updated} from recorded attendance.${upTo}` };
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

  const derived = deriveHours({
    workDate: input.workDate,
    startTime: input.startTime,
    endTime: input.endTime,
    breakMinutes: input.breakMinutes,
  });

  if (!derived.ok) {
    return {
      fieldErrors: { [derived.field]: derived.message },
      error: derived.message,
      values,
    };
  }
  const { startIso, endIso, endsNextDay, paidHours } = derived.value;

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
      paid_hours: paidHours,
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
  return { success: `Recorded ${paidHours} h for ${input.workDate}.` };
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Variance of corrected hours against what was rostered.
 *
 * Null when the day was never rostered — there is nothing to compare to, and
 * zero would read as "matched the roster".
 *
 * The PLANNED unpaid break comes back off the rostered side, which means
 * reading it from the shift. `generateTimesheet` subtracts it when variance
 * is first computed, so leaving it out here would compare against a longer
 * rostered day and overstate every shortfall by the length of the break.
 */
async function varianceAgainstRoster(
  supabase: ServerClient,
  sheet: {
    rostered_start: string | null;
    rostered_end: string | null;
    shift_id: string | null;
  },
  paidHours: number,
): Promise<number | null> {
  if (!sheet.rostered_start || !sheet.rostered_end) return null;

  let plannedUnpaid = 0;
  if (sheet.shift_id) {
    const { data: breaks } = await supabase
      .from("shift_breaks")
      .select("duration_minutes, is_paid")
      .eq("shift_id", sheet.shift_id);

    plannedUnpaid = (breaks ?? [])
      .filter((b) => !b.is_paid)
      .reduce((total, b) => total + Number(b.duration_minutes ?? 0), 0);
  }

  return round2(
    paidHours -
      rosteredHours({
        startsAt: sheet.rostered_start,
        endsAt: sheet.rostered_end,
        unpaidBreakMinutes: plannedUnpaid,
      }),
  );
}

const editHoursSchema = z.object({
  timesheetId: z.string().uuid(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Enter a start time."),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Enter a finish time."),
  breakMinutes: z.number().int().min(0).max(600),
  managerNote: z.string().trim().max(500).optional(),
});

/**
 * Correct the hours on an existing timesheet.
 *
 * Until this existed, recorded hours could never be changed: every write of
 * `actual_start`, `actual_end` and `paid_hours` was an INSERT. A mistyped
 * manual entry or a missed clock-out reached payroll with no way to fix it,
 * and the staff correction route had nowhere to land.
 *
 * Editing an already-approved timesheet sends it BACK to `manager_review`
 * and clears the approval. An approval is a statement about particular
 * figures; silently keeping it against different ones would misrepresent
 * who signed off on what.
 *
 * Clock events are untouched. They are append-only evidence, and a
 * corrected timesheet must never destroy the record it was corrected from —
 * the original remains recoverable by regenerating from the events.
 */
export async function updateTimesheetHours(
  _prev: TimesheetActionState,
  formData: FormData,
): Promise<TimesheetActionState> {
  const user = await requireRole("manager");

  const breakRaw = formData.get("breakMinutes");
  const parsed = editHoursSchema.safeParse({
    timesheetId: formData.get("timesheetId"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    breakMinutes: breakRaw ? Number(breakRaw) : 0,
    managerNote: (formData.get("managerNote") as string) || undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors, error: "Check the highlighted fields." };
  }

  const input = parsed.data;

  try {
    const supabase = await createClient();

    const { data: sheet, error: readError } = await supabase
      .from("timesheets")
      .select(
        "id, user_id, work_date, status, locked_at, exported_at, rostered_start, rostered_end, shift_id",
      )
      .eq("id", input.timesheetId)
      .maybeSingle();

    if (readError) return { error: "Could not read that timesheet." };
    if (!sheet) return { error: "That timesheet is no longer available." };
    if (sheet.locked_at) {
      return {
        error:
          "This timesheet is locked. Ask an administrator to reopen it before changing the hours.",
      };
    }
    if (sheet.exported_at) {
      return {
        error:
          "This timesheet has already gone to payroll. Correct it there, or ask an administrator to reopen it.",
      };
    }

    const derived = deriveHours({
      workDate: String(sheet.work_date),
      startTime: input.startTime,
      endTime: input.endTime,
      breakMinutes: input.breakMinutes,
    });

    if (!derived.ok) {
      return {
        fieldErrors: { [derived.field]: derived.message },
        error: derived.message,
      };
    }

    const varianceHours = await varianceAgainstRoster(
      supabase,
      sheet,
      derived.value.paidHours,
    );

    const wasApproved = sheet.status === "approved";

    // Built as an explicitly typed object rather than with conditional
    // spreads inside `.update()`, so the columns being written are checked
    // against the generated row type and are legible in one place.
    const patch: TimesheetUpdate = {
      actual_start: derived.value.startIso,
      actual_end: derived.value.endIso,
      break_minutes: input.breakMinutes,
      paid_hours: derived.value.paidHours,
      variance_hours: varianceHours,
      // Hours now exist, so a no-show is no longer the right description.
      is_no_show: false,
    };

    if (wasApproved) {
      patch.status = "manager_review";
      patch.approved_by = null;
      patch.approved_at = null;
    }
    if (input.managerNote) patch.manager_note = input.managerNote;

    const { error } = await supabase
      .from("timesheets")
      .update(patch)
      .eq("id", input.timesheetId)
      .select("id, user_id")
      .maybeSingle();

    if (error) return { error: `Could not save the change: ${error.message}` };

    // The staff member is told, because their pay just changed.
    await notify({
      organisationId: user.organisationId,
      userIds: [String(sheet.user_id)],
      category: "timesheet_correction",
      title: "Your recorded hours were changed",
      body: `Your hours for ${sheet.work_date} were updated. Open StayFlow to check them.`,
      deepLink: "/timesheets",
    });

    revalidatePath("/manage/timesheets");
    revalidatePath("/timesheets");
    return {
      success: wasApproved
        ? `Updated to ${derived.value.paidHours} h. The approval was cleared, so it needs approving again.`
        : `Updated to ${derived.value.paidHours} h.`,
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
  const user = await requireUser();

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
        // Only when a note was actually typed. Writing null for an empty box
        // erased whatever the person had written before, and the confirm
        // button sends no note field at all — so every acknowledgement
        // cleared it.
        ...(parsed.data.note ? { staff_note: parsed.data.note } : {}),
      })
      .eq("id", parsed.data.id)
      // Scoped to the caller's OWN timesheet, not left to RLS.
      //
      // `timesheets_write_manager` is a `for all` policy, so a manager
      // updating another person's row passes RLS happily. This column is
      // evidence that the STAFF MEMBER checked their own hours; a manager
      // able to set it is the one thing it must not allow.
      .eq("user_id", user.id);

    if (error) return { error: error.message };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }

  revalidatePath("/timesheets");
  return { success: "Thanks — your manager can see you have checked these." };
}

const correctionSchema = z.object({
  timesheetId: z.string().uuid(),
  // Both times need the same shape. Only the finish was validated, so a
  // malformed start reached `localDateTimeToIso`, which throws — and the
  // outer catch turned that into "Cannot reach StayFlow right now", sending
  // someone to check their signal over a typo.
  requestedStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Enter a start time as hh:mm.")
    .optional(),
  requestedEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Enter a finish time as hh:mm.")
    .optional(),
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

    // The form sends wall-clock times ("09:00") and these columns are
    // timestamptz. Handing the bare string to Postgres stamped it onto
    // TODAY in the session timezone, so a correction for last Tuesday was
    // stored against this morning — anchor it to the timesheet's own date
    // in the property timezone instead.
    const workDate = String(sheet.work_date);
    const bothTimes = parsed.data.requestedStart && parsed.data.requestedEnd;
    const overnight =
      bothTimes && parsed.data.requestedEnd! <= parsed.data.requestedStart!;

    const requestedStart = parsed.data.requestedStart
      ? localDateTimeToIso(`${workDate}T${parsed.data.requestedStart}`)
      : null;
    const requestedEnd = parsed.data.requestedEnd
      ? localDateTimeToIso(
          `${overnight ? addIsoDays(workDate, 1) : workDate}T${parsed.data.requestedEnd}`,
        )
      : null;

    const { error } = await supabase
      .from("timesheet_adjustment_requests")
      .insert({
        organisation_id: user.organisationId,
        timesheet_id: parsed.data.timesheetId,
        user_id: user.id,
        requested_date: workDate,
        requested_start: requestedStart,
        requested_end: requestedEnd,
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
        // Only written when a note was actually typed. Sending `null` for an
        // empty box ERASED whatever note was already there, across every
        // timesheet in a bulk approval — including the reply a manager wrote
        // when declining a correction request, which is the only way the
        // staff member ever sees that answer.
        ...(parsed.data.managerNote
          ? { manager_note: parsed.data.managerNote }
          : {}),
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

/* ------------------------------------------------------------------ */
/* Manager: acting on a staff correction request                       */
/* ------------------------------------------------------------------ */

const resolveSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["approved", "declined"]),
  managerNote: z.string().trim().max(500).optional(),
});

/**
 * Approve or decline a staff correction request.
 *
 * `requestCorrection` has always written these rows, but nothing ever read
 * them: a staff member could report that their hours were wrong and the
 * request would sit in the table forever, invisible. This closes that loop.
 *
 * Approving APPLIES the requested figures to the timesheet rather than just
 * marking the request agreed — a request marked approved while the hours
 * stayed wrong is the same dead end in a different costume.
 *
 * The requested times were stored as instants against the timesheet's own
 * date, so they are written straight through; only `paid_hours` is
 * recomputed, from the same arithmetic every other path uses.
 */
export async function resolveAdjustmentRequest(
  _prev: TimesheetActionState,
  formData: FormData,
): Promise<TimesheetActionState> {
  const user = await requireRole("manager");

  const parsed = resolveSchema.safeParse({
    requestId: formData.get("requestId"),
    decision: formData.get("decision"),
    managerNote: (formData.get("managerNote") as string) || undefined,
  });

  if (!parsed.success) return { error: "That request could not be identified." };
  const { requestId, decision, managerNote } = parsed.data;

  try {
    const supabase = await createClient();

    const { data: request, error: readError } = await supabase
      .from("timesheet_adjustment_requests")
      .select(
        "id, timesheet_id, user_id, status, requested_start, requested_end, requested_break_minutes",
      )
      .eq("id", requestId)
      .maybeSingle();

    if (readError) return { error: "Could not read that request." };
    if (!request) return { error: "That request is no longer available." };
    if (request.status !== "open") {
      return { error: "That request has already been dealt with." };
    }

    if (decision === "approved") {
      if (!request.timesheet_id) {
        return {
          error:
            "This request is not attached to a timesheet. Enter the hours manually, then decline it with a note.",
        };
      }

      const { data: sheet } = await supabase
        .from("timesheets")
        .select(
          "id, break_minutes, locked_at, exported_at, status, work_date, rostered_start, rostered_end, shift_id",
        )
        .eq("id", request.timesheet_id)
        .maybeSingle();

      if (!sheet) return { error: "That timesheet is no longer available." };
      if (sheet.locked_at || sheet.exported_at) {
        return {
          error:
            "That timesheet has gone to payroll. Ask an administrator to reopen it before applying this.",
        };
      }

      // Only the fields the staff member actually filled in are applied; the
      // rest of the timesheet stays as recorded.
      const startIso = request.requested_start
        ? String(request.requested_start)
        : null;
      const endIso = request.requested_end ? String(request.requested_end) : null;
      const breakMinutes =
        request.requested_break_minutes ?? Number(sheet.break_minutes ?? 0);

      if (!startIso || !endIso) {
        return {
          error:
            "This request did not include both a start and a finish. Edit the hours directly, then decline it with a note.",
        };
      }

      const paidHours = round2(
        (Date.parse(endIso) - Date.parse(startIso)) / 3_600_000 -
          breakMinutes / 60,
      );

      if (paidHours <= 0 || paidHours > MAX_ENTRY_HOURS) {
        return {
          error:
            "Those times do not make a sensible shift. Edit the hours directly instead.",
        };
      }

      const { error: applyError } = await supabase
        .from("timesheets")
        .update({
          actual_start: startIso,
          actual_end: endIso,
          break_minutes: breakMinutes,
          paid_hours: paidHours,
          // Recomputed, not left alone: the old figure was derived from the
          // hours this correction is replacing.
          variance_hours: await varianceAgainstRoster(
            supabase,
            sheet,
            paidHours,
          ),
          is_no_show: false,
          // Corrected figures need looking at again, even if this timesheet
          // had already been approved on the old ones.
          status: "manager_review" as const,
          approved_by: null,
          approved_at: null,
        })
        .eq("id", request.timesheet_id);

      if (applyError) {
        return { error: `Could not apply the correction: ${applyError.message}` };
      }
    }

    const { error: closeError } = await supabase
      .from("timesheet_adjustment_requests")
      .update({
        status: decision,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        manager_note: managerNote ?? null,
      })
      .eq("id", requestId)
      .eq("status", "open");

    if (closeError) {
      return { error: `Could not close the request: ${closeError.message}` };
    }

    // Mirror the reply onto the timesheet itself. Nothing shows staff the
    // request rows, but `TimesheetCard` already renders `manager_note` — so
    // without this a declined correction is answered into a void, which is
    // the dead end this whole action exists to remove.
    if (managerNote && request.timesheet_id) {
      await supabase
        .from("timesheets")
        .update({ manager_note: managerNote })
        .eq("id", request.timesheet_id);
    }

    await notify({
      organisationId: user.organisationId,
      userIds: [String(request.user_id)],
      category: "timesheet_correction",
      title:
        decision === "approved"
          ? "Your correction was applied"
          : "Your correction was not applied",
      body:
        decision === "approved"
          ? "Your recorded hours have been updated. Open StayFlow to check them."
          : "Your manager has responded to your correction request. Open StayFlow to read it.",
      deepLink: "/timesheets",
    });

    revalidatePath("/manage/timesheets");
    revalidatePath("/timesheets");
    return {
      success:
        decision === "approved"
          ? "Correction applied. The timesheet needs approving again."
          : "Request declined.",
    };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }
}

/* ------------------------------------------------------------------ */
/* Sending a period to payroll, and taking it back                     */
/* ------------------------------------------------------------------ */

const periodSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date."),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an end date."),
  propertyId: z.union([z.string().uuid(), z.literal("")]).optional(),
  confirm: z.boolean().optional(),
});

/** Narrow a timesheet query to a period, and optionally one property. */
function withinPeriod<T extends { eq: (c: string, v: string) => T; gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(
  query: T,
  fromDate: string,
  toDate: string,
  propertyId?: string,
): T {
  const scoped = query.gte("work_date", fromDate).lte("work_date", toDate);
  return propertyId ? scoped.eq("property_id", propertyId) : scoped;
}

/**
 * Mark an approved period as sent to payroll.
 *
 * This is what finally writes `exported_at` and makes the "Sent to payroll"
 * status reachable. It is also the point of no return for corrections:
 * `updateTimesheetHours` and `resolveAdjustmentRequest` both refuse an
 * exported timesheet, so this is confirmed before it runs and can be undone
 * by `reopenExportedPeriod`.
 *
 * ONLY approved timesheets are marked. Anything still awaiting a decision is
 * left alone and REPORTED — silently sweeping up unapproved hours would send
 * figures nobody agreed to, and silently leaving them behind without saying
 * so is an underpayment that surfaces on payday.
 */
export async function markPeriodExported(
  _prev: TimesheetActionState,
  formData: FormData,
): Promise<TimesheetActionState> {
  // The role check is the point; RLS scopes which rows are affected.
  await requireRole("manager");

  const parsed = periodSchema.safeParse({
    fromDate: formData.get("fromDate"),
    toDate: formData.get("toDate"),
    propertyId: (formData.get("propertyId") as string) || "",
    confirm: formData.get("confirm") === "on",
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { fromDate, toDate, propertyId, confirm } = parsed.data;
  if (toDate < fromDate) {
    return { error: "The end date cannot be before the start date." };
  }

  const values = { workDate: fromDate };

  try {
    const supabase = await createClient();

    // What is ready, and what would be left behind.
    const [readyRes, pendingRes] = await Promise.all([
      withinPeriod(
        supabase
          .from("timesheets")
          .select("id", { count: "exact", head: true })
          .eq("status", "approved")
          .is("exported_at", null),
        fromDate,
        toDate,
        propertyId || undefined,
      ),
      withinPeriod(
        supabase
          .from("timesheets")
          .select("id", { count: "exact", head: true })
          .in("status", [
            "draft",
            "submitted",
            "manager_review",
            "staff_review_requested",
          ]),
        fromDate,
        toDate,
        propertyId || undefined,
      ),
    ]);

    if (readyRes.error || pendingRes.error) {
      return { error: "Could not check that period." };
    }

    const ready = readyRes.count ?? 0;
    const pending = pendingRes.count ?? 0;

    if (ready === 0) {
      return {
        error:
          pending > 0
            ? `Nothing in that period is approved yet — ${pending} timesheet${pending === 1 ? " is" : "s are"} still waiting for a decision.`
            : "There are no approved timesheets in that period.",
      };
    }

    if (!confirm) {
      return {
        needsConfirmation: true,
        values,
        error:
          `This will mark ${ready} approved timesheet${ready === 1 ? "" : "s"} as sent to payroll. ` +
          `Their hours can no longer be corrected unless an administrator reopens them.` +
          (pending > 0
            ? ` ${pending} timesheet${pending === 1 ? "" : "s"} in this period ${pending === 1 ? "is" : "are"} still awaiting a decision and will NOT be included.`
            : ""),
      };
    }

    const now = new Date().toISOString();
    const { data, error } = await withinPeriod(
      supabase
        .from("timesheets")
        .update({ status: "exported" as const, exported_at: now })
        // Repeated in the write so a timesheet approved-and-edited between
        // the count and here cannot be swept in.
        .eq("status", "approved")
        .is("exported_at", null),
      fromDate,
      toDate,
      propertyId || undefined,
    ).select("id");

    if (error) return { error: `Could not mark the period: ${error.message}` };

    const marked = data?.length ?? 0;
    revalidatePath("/manage/timesheets");
    revalidatePath("/timesheets");

    return {
      success:
        `Marked ${marked} timesheet${marked === 1 ? "" : "s"} as sent to payroll.` +
        (pending > 0
          ? ` ${pending} still awaiting a decision ${pending === 1 ? "was" : "were"} left out.`
          : ""),
    };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }
}

/**
 * Take a period back from payroll so it can be corrected.
 *
 * Administrator only, and the exact inverse of `markPeriodExported`: it
 * clears `exported_at` and returns the status to `approved`, leaving the
 * approval itself intact. Editing the hours afterwards clears that approval
 * on its own, which is `updateTimesheetHours`'s job, not this one's.
 *
 * Without this, one mis-clicked export would permanently block every
 * correction for that period — the same dead end the correction queue was
 * built to remove.
 */
export async function reopenExportedPeriod(
  _prev: TimesheetActionState,
  formData: FormData,
): Promise<TimesheetActionState> {
  await requireRole("administrator");

  const parsed = periodSchema.safeParse({
    fromDate: formData.get("fromDate"),
    toDate: formData.get("toDate"),
    propertyId: (formData.get("propertyId") as string) || "",
    confirm: formData.get("confirm") === "on",
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { fromDate, toDate, propertyId } = parsed.data;
  if (toDate < fromDate) {
    return { error: "The end date cannot be before the start date." };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await withinPeriod(
      supabase
        .from("timesheets")
        .update({ status: "approved" as const, exported_at: null })
        .eq("status", "exported")
        // A locked timesheet is a further step and is not undone here.
        .is("locked_at", null),
      fromDate,
      toDate,
      propertyId || undefined,
    ).select("id");

    if (error) return { error: `Could not reopen that period: ${error.message}` };

    const reopened = data?.length ?? 0;
    if (reopened === 0) {
      return {
        error:
          "Nothing in that period is marked as sent to payroll, or it has been locked.",
      };
    }

    revalidatePath("/manage/timesheets");
    revalidatePath("/timesheets");
    return {
      success: `Reopened ${reopened} timesheet${reopened === 1 ? "" : "s"} for correction.`,
    };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }
}
