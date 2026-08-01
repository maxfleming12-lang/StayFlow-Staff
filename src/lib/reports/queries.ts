import { createClient } from "@/lib/supabase/server";
import { addIsoDays, startOfLocalDay } from "@/lib/format";
import type { ReportShift, ReportTimesheet } from "./labour";

/**
 * Data behind the labour report.
 *
 * RLS scopes both reads to the properties the caller manages, so a
 * Coastal-only manager cannot widen the report by choosing a property id
 * they do not hold.
 */

export interface LabourReportData {
  shifts: ReportShift[];
  timesheets: ReportTimesheet[];
  /** Display names, keyed by user id. */
  names: Map<string, string>;
}

/** How many rows a single read will return before it stops. */
export const REPORT_ROW_LIMIT = 2000;

export async function getLabourReportData(
  fromDate: string,
  toDate: string,
  propertyId?: string,
): Promise<LabourReportData> {
  const supabase = await createClient();

  // Shifts are instants, so the period is a half-open range of LOCAL days:
  // local midnight on `fromDate` to local midnight on the day after
  // `toDate`. Timesheets carry a plain `work_date`, which is already a
  // local calendar date and compares directly.
  const from = startOfLocalDay(fromDate);
  const until = startOfLocalDay(addIsoDays(toDate, 1));

  let shiftQuery = supabase
    .from("shifts")
    .select(
      "id, user_id, property_id, starts_at, ends_at, shift_breaks ( duration_minutes, is_paid )",
    )
    .eq("status", "published")
    .is("archived_at", null)
    .gte("starts_at", from)
    .lt("starts_at", until)
    .limit(REPORT_ROW_LIMIT);

  let sheetQuery = supabase
    .from("timesheets")
    .select("id, user_id, property_id, work_date, paid_hours, is_no_show, actual_start, actual_end")
    .gte("work_date", fromDate)
    .lte("work_date", toDate)
    .limit(REPORT_ROW_LIMIT);

  if (propertyId) {
    shiftQuery = shiftQuery.eq("property_id", propertyId);
    sheetQuery = sheetQuery.eq("property_id", propertyId);
  }

  const [shiftRes, sheetRes] = await Promise.all([shiftQuery, sheetQuery]);

  // Both are checked. A silently failed read would produce a report that
  // looks complete and understates somebody's hours.
  if (shiftRes.error) {
    throw new Error(`Could not read the roster: ${shiftRes.error.message}`);
  }
  if (sheetRes.error) {
    throw new Error(`Could not read timesheets: ${sheetRes.error.message}`);
  }

  const shifts: ReportShift[] = (shiftRes.data ?? []).map((row) => {
    const breaks = Array.isArray(row.shift_breaks) ? row.shift_breaks : [];
    return {
      id: String(row.id),
      userId: (row.user_id as string | null) ?? null,
      propertyId: String(row.property_id),
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      unpaidBreakMinutes: breaks
        .filter((b) => !(b as Record<string, unknown>).is_paid)
        .reduce(
          (total, b) =>
            total + Number((b as Record<string, unknown>).duration_minutes ?? 0),
          0,
        ),
    };
  });

  const timesheets: ReportTimesheet[] = (sheetRes.data ?? []).map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    propertyId: String(row.property_id),
    workDate: String(row.work_date),
    paidHours: row.paid_hours != null ? Number(row.paid_hours) : null,
    isNoShow: Boolean(row.is_no_show),
    actualStart: (row.actual_start as string | null) ?? null,
    actualEnd: (row.actual_end as string | null) ?? null,
  }));

  const userIds = [
    ...new Set([
      ...shifts.map((s) => s.userId).filter((id): id is string => Boolean(id)),
      ...timesheets.map((t) => t.userId),
    ]),
  ];

  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, preferred_name, legal_first_name, legal_last_name")
      .in("id", userIds);

    for (const profile of profiles ?? []) {
      const preferred = (profile.preferred_name as string | null)?.trim();
      names.set(
        String(profile.id),
        preferred && preferred.length > 0
          ? preferred
          : `${profile.legal_first_name ?? ""} ${profile.legal_last_name ?? ""}`.trim() ||
              "Unknown",
      );
    }
  }

  return { shifts, timesheets, names };
}

/** True when a read hit its ceiling and the report may be incomplete. */
export function mayBeTruncated(data: LabourReportData): boolean {
  return (
    data.shifts.length >= REPORT_ROW_LIMIT ||
    data.timesheets.length >= REPORT_ROW_LIMIT
  );
}
