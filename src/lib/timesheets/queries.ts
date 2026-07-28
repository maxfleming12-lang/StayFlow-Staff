import { createClient } from "@/lib/supabase/server";

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

/** Timesheets a manager needs to review, oldest first. */
export async function getTimesheetsForReview(
  status?: string,
): Promise<TimesheetRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("timesheets")
    .select(SELECT)
    .order("work_date", { ascending: true })
    .limit(200);

  if (status) {
    query = query.eq(
      "status",
      status as "draft" | "submitted" | "manager_review" | "approved",
    );
  } else {
    // Default to what actually needs a decision.
    query = query.in("status", [
      "draft",
      "submitted",
      "manager_review",
      "staff_review_requested",
    ]);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load timesheets: ${error.message}`);
  return (data ?? []).map(map);
}
