import { createClient } from "@/lib/supabase/server";
import {
  TIMESHEET_VIEWS,
  TIMESHEET_VIEW_LIMIT,
  type TimesheetView,
} from "./views";

/**
 * Timesheet queries.
 *
 * RLS decides scope, as everywhere else: staff receive their own rows,
 * managers receive rows for their properties.
 */

export interface TimesheetRow {
  id: string;
  userId: string;
  staffName: string;
  workDate: string;
  propertyName: string;
  rosteredStart: string | null;
  rosteredEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  breakMinutes: number;
  paidHours: number | null;
  varianceHours: number | null;
  status: string;
  isNoShow: boolean;
  staffNote: string | null;
  managerNote: string | null;
  staffAcknowledgedAt: string | null;
  lockedAt: string | null;
}

const SELECT = `id, user_id, work_date, rostered_start, rostered_end,
  actual_start, actual_end, break_minutes, paid_hours, variance_hours,
  status, is_no_show, staff_note, manager_note, staff_acknowledged_at,
  locked_at,
  profiles!timesheets_profile_fk ( preferred_name, legal_first_name, legal_last_name ),
  properties ( name )`;

function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return (value as Record<string, unknown>) ?? null;
}

function map(row: Record<string, unknown>): TimesheetRow {
  const profile = one(row.profiles);
  const property = one(row.properties);
  const preferred = (profile?.preferred_name as string | null)?.trim();

  return {
    id: String(row.id),
    userId: String(row.user_id),
    staffName:
      preferred && preferred.length > 0
        ? preferred
        : `${profile?.legal_first_name ?? ""} ${profile?.legal_last_name ?? ""}`.trim() ||
          "Unknown",
    workDate: String(row.work_date),
    propertyName: property ? String(property.name) : "Unknown",
    rosteredStart: (row.rostered_start as string | null) ?? null,
    rosteredEnd: (row.rostered_end as string | null) ?? null,
    actualStart: (row.actual_start as string | null) ?? null,
    actualEnd: (row.actual_end as string | null) ?? null,
    breakMinutes: Number(row.break_minutes ?? 0),
    paidHours: row.paid_hours != null ? Number(row.paid_hours) : null,
    varianceHours: row.variance_hours != null ? Number(row.variance_hours) : null,
    status: String(row.status),
    isNoShow: Boolean(row.is_no_show),
    staffNote: (row.staff_note as string | null) ?? null,
    managerNote: (row.manager_note as string | null) ?? null,
    staffAcknowledgedAt: (row.staff_acknowledged_at as string | null) ?? null,
    lockedAt: (row.locked_at as string | null) ?? null,
  };
}

/** The signed-in staff member's own timesheets, newest first. */
export async function getMyTimesheets(limit = 60): Promise<TimesheetRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timesheets")
    .select(SELECT)
    .order("work_date", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Could not load your hours: ${error.message}`);
  return (data ?? []).map(map);
}

export {
  TIMESHEET_VIEWS,
  TIMESHEET_VIEW_LIMIT,
  isTimesheetView,
  type TimesheetView,
} from "./views";

/** Timesheets in one view, oldest first. */
export async function getTimesheetsForReview(
  view: TimesheetView = "open",
): Promise<TimesheetRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("timesheets")
    .select(SELECT)
    .in("status", [...TIMESHEET_VIEWS[view].statuses])
    .order("work_date", { ascending: true })
    .limit(TIMESHEET_VIEW_LIMIT);

  if (error) throw new Error(`Could not load timesheets: ${error.message}`);
  return (data ?? []).map(map);
}

const ADJUSTMENT_SELECT = `id, timesheet_id, user_id, requested_date,
  requested_start, requested_end, requested_break_minutes, explanation,
  created_at,
  profiles!timesheet_adjustment_requests_profile_fk ( preferred_name, legal_first_name, legal_last_name )`;

/** A staff correction request as the manager queue needs it. */
export interface AdjustmentRequest {
  id: string;
  timesheetId: string | null;
  userId: string;
  staffName: string;
  requestedDate: string | null;
  requestedStart: string | null;
  requestedEnd: string | null;
  requestedBreakMinutes: number | null;
  explanation: string;
  createdAt: string;
  /** The hours currently recorded, for comparison. Null if unattached. */
  current: {
    actualStart: string | null;
    actualEnd: string | null;
    breakMinutes: number;
    paidHours: number | null;
    status: string;
    lockedAt: string | null;
    exportedAt: string | null;
  } | null;
}

/**
 * Open correction requests waiting on a manager.
 *
 * These rows have been written since the timesheet feature shipped and were
 * never read by anything, so a staff member reporting wrong hours got no
 * response. RLS (`adjustment_write_manager`) scopes them to staff the
 * caller actually manages.
 */
export async function getOpenAdjustmentRequests(): Promise<AdjustmentRequest[]> {
  const supabase = await createClient();

  // Two plain queries rather than one nested embed. postgrest-js parses the
  // select string in the type system, and deep embeds get expensive there
  // for no runtime gain; the second lookup is keyed and cheap.
  const { data, error } = await supabase
    .from("timesheet_adjustment_requests")
    .select(ADJUSTMENT_SELECT)
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    throw new Error(`Could not load correction requests: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  const sheetIds = [
    ...new Set(
      rows
        .map((row) => row.timesheet_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];

  const sheetById = new Map<string, Record<string, unknown>>();
  if (sheetIds.length > 0) {
    const { data: sheetData, error: sheetError } = await supabase
      .from("timesheets")
      .select(
        "id, actual_start, actual_end, break_minutes, paid_hours, status, locked_at, exported_at",
      )
      .in("id", sheetIds);

    if (sheetError) {
      throw new Error(
        `Could not load the timesheets behind those requests: ${sheetError.message}`,
      );
    }
    for (const sheet of sheetData ?? []) {
      sheetById.set(String(sheet.id), sheet as Record<string, unknown>);
    }
  }

  return rows.map((record) => {
    const profile = one(record.profiles);
    const sheet =
      typeof record.timesheet_id === "string"
        ? (sheetById.get(record.timesheet_id) ?? null)
        : null;

    return {
      id: String(record.id),
      timesheetId: (record.timesheet_id as string | null) ?? null,
      userId: String(record.user_id),
      staffName: profile
        ? String(
            (profile.preferred_name as string | null)?.trim() ||
              `${profile.legal_first_name ?? ""} ${profile.legal_last_name ?? ""}`.trim() ||
              "Unknown",
          )
        : "Unknown",
      requestedDate: (record.requested_date as string | null) ?? null,
      requestedStart: (record.requested_start as string | null) ?? null,
      requestedEnd: (record.requested_end as string | null) ?? null,
      requestedBreakMinutes:
        record.requested_break_minutes == null
          ? null
          : Number(record.requested_break_minutes),
      explanation: String(record.explanation ?? ""),
      createdAt: String(record.created_at),
      current: sheet
        ? {
            actualStart: (sheet.actual_start as string | null) ?? null,
            actualEnd: (sheet.actual_end as string | null) ?? null,
            breakMinutes: Number(sheet.break_minutes ?? 0),
            paidHours:
              sheet.paid_hours == null ? null : Number(sheet.paid_hours),
            status: String(sheet.status ?? ""),
            lockedAt: (sheet.locked_at as string | null) ?? null,
            exportedAt: (sheet.exported_at as string | null) ?? null,
          }
        : null,
    };
  });
}

/**
 * Every timesheet in a date range, for export.
 *
 * Deliberately unlike `getTimesheetsForReview`: that one shows what still
 * needs a decision and caps at 200 rows. Payroll needs the whole period
 * including everything already approved, so this filters by date instead of
 * status and pages through rather than truncating — a fortnight for two
 * motels can exceed any single-page limit, and a silently short export is
 * an underpayment.
 *
 * RLS scopes the result to properties the caller manages.
 */
export async function getTimesheetsForExport(
  fromDate: string,
  toDate: string,
  propertyId?: string,
): Promise<TimesheetRow[]> {
  const supabase = await createClient();
  const PAGE = 1000;
  const rows: TimesheetRow[] = [];

  for (let offset = 0; ; offset += PAGE) {
    let query = supabase
      .from("timesheets")
      .select(SELECT)
      .gte("work_date", fromDate)
      .lte("work_date", toDate)
      .order("work_date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (propertyId) query = query.eq("property_id", propertyId);

    const { data, error } = await query;
    if (error) {
      throw new Error(`Could not load timesheets to export: ${error.message}`);
    }

    const page = data ?? [];
    rows.push(...page.map(map));
    if (page.length < PAGE) break;
  }

  return rows;
}
