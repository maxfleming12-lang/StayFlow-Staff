import { createClient } from "@/lib/supabase/server";
import { addIsoDays, startOfLocalDay } from "@/lib/format";
import type { Database } from "@/types/database";

/** The leave_status enum, straight from the generated schema types. */
export type LeaveStatus = Database["public"]["Enums"]["leave_status"];

const LEAVE_STATUSES: LeaveStatus[] = [
  "pending",
  "approved",
  "declined",
  "cancelled",
];

/**
 * Narrow an untrusted value (a URL query parameter) to a real leave status.
 *
 * Returns undefined for anything unrecognised, which the caller treats as
 * "no filter" rather than passing a bogus value to the database.
 */
export function parseLeaveStatus(value: unknown): LeaveStatus | undefined {
  return LEAVE_STATUSES.find((s) => s === value);
}

/**
 * Leave queries.
 *
 * Row Level Security decides scope: staff receive their own rows, managers
 * receive rows for staff at properties assigned to them, administrators the
 * whole organisation. None of that is re-implemented here.
 */

export interface LeaveRequest {
  id: string;
  userId: string;
  staffName: string;
  category: string;
  firstDate: string;
  lastDate: string;
  isPartialDay: boolean;
  startTime: string | null;
  endTime: string | null;
  totalHours: number | null;
  note: string | null;
  status: string;
  managerNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  /** Published shifts that fall inside the requested dates. */
  conflictingShifts: {
    id: string;
    startsAt: string;
    endsAt: string;
    propertyName: string;
  }[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return (value as Record<string, unknown>) ?? null;
}

function mapLeave(row: Record<string, unknown>): LeaveRequest {
  const profile = asRecord(row.profiles);
  const preferred = (profile?.preferred_name as string | null)?.trim();
  const first = String(profile?.legal_first_name ?? "");
  const last = String(profile?.legal_last_name ?? "");

  return {
    id: String(row.id),
    userId: String(row.user_id),
    staffName:
      preferred && preferred.length > 0
        ? preferred
        : `${first} ${last}`.trim() || "Unknown",
    category: String(row.category),
    firstDate: String(row.first_date),
    lastDate: String(row.last_date),
    isPartialDay: Boolean(row.is_partial_day),
    startTime: (row.start_time as string | null) ?? null,
    endTime: (row.end_time as string | null) ?? null,
    totalHours: row.total_hours != null ? Number(row.total_hours) : null,
    note: (row.note as string | null) ?? null,
    status: String(row.status),
    managerNote: (row.manager_note as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    createdAt: String(row.created_at),
    conflictingShifts: [],
  };
}

const LEAVE_SELECT = `id, user_id, category, first_date, last_date,
  is_partial_day, start_time, end_time, total_hours, note, status,
  manager_note, reviewed_at, created_at,
  profiles!leave_requests_profile_fk ( preferred_name, legal_first_name, legal_last_name )`;

/** The signed-in staff member's own leave requests, newest first. */
export async function getMyLeave(): Promise<LeaveRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leave_requests")
    .select(LEAVE_SELECT)
    .is("archived_at", null)
    .order("first_date", { ascending: false });

  if (error) throw new Error(`Could not load your leave: ${error.message}`);
  return (data ?? []).map(mapLeave);
}

/**
 * Leave requests visible to management, with roster conflicts attached.
 *
 * A manager approving leave needs to see immediately whether the person is
 * already rostered during it — otherwise approval silently creates a hole in
 * the roster that nobody notices until the day.
 */
export async function getLeaveForReview(
  status?: LeaveStatus,
): Promise<LeaveRequest[]> {
  const supabase = await createClient();

  let query = supabase
    .from("leave_requests")
    .select(LEAVE_SELECT)
    .is("archived_at", null)
    .order("first_date", { ascending: true });

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Could not load leave requests: ${error.message}`);
  }

  const requests = (data ?? []).map(mapLeave);
  if (requests.length === 0) return requests;

  // One query for every shift that could clash, rather than one per request.
  const earliest = requests.reduce(
    (min, r) => (r.firstDate < min ? r.firstDate : min),
    requests[0].firstDate,
  );
  const latest = requests.reduce(
    (max, r) => (r.lastDate > max ? r.lastDate : max),
    requests[0].lastDate,
  );

  // Half-open [from, until) across the property's local days. `${latest}
  // T23:59:59` was parsed against the host clock, so on a UTC server the
  // window ran ten hours past the intended end of the last leave day — and
  // would have fallen short of it on a negative-offset host.
  const from = startOfLocalDay(earliest);
  const until = startOfLocalDay(addIsoDays(latest, 1));

  const { data: shifts, error: shiftError } = await supabase
    .from("shifts")
    .select(
      "id, user_id, starts_at, ends_at, properties!shifts_property_id_fkey ( name )",
    )
    .gte("starts_at", from)
    .lt("starts_at", until)
    .eq("status", "published")
    .is("archived_at", null);

  if (shiftError) {
    throw new Error(`Could not check roster conflicts: ${shiftError.message}`);
  }

  for (const request of requests) {
    request.conflictingShifts = (shifts ?? [])
      .filter((s) => {
        if (s.user_id !== request.userId) return false;
        const day = new Intl.DateTimeFormat("en-CA", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          timeZone: "Australia/Sydney",
        }).format(new Date(String(s.starts_at)));
        return day >= request.firstDate && day <= request.lastDate;
      })
      .map((s) => {
        const property = asRecord((s as Record<string, unknown>).properties);
        return {
          id: String(s.id),
          startsAt: String(s.starts_at),
          endsAt: String(s.ends_at),
          propertyName: property ? String(property.name) : "Unknown",
        };
      });
  }

  return requests;
}
