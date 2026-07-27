import { createClient } from "@/lib/supabase/server";
import { paidHours } from "./hours";
import { weekRange } from "./week";
import type {
  AvailabilityRule,
  CandidateShift,
  LeavePeriod,
} from "./conflicts";

/**
 * Manager-side roster queries.
 *
 * Row Level Security scopes every result to properties the caller may access,
 * so these functions ask for what the screen needs and let the database
 * decide what comes back.
 */

export interface RosterShift {
  id: string;
  userId: string | null;
  propertyId: string;
  propertyName: string;
  propertyColour: string | null;
  teamName: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  notes: string | null;
  requiredRole: string | null;
  isOpenShift: boolean;
  breaks: { durationMinutes: number; isPaid: boolean }[];
  paidHours: number;
  ackStatus: string | null;
}

export interface RosterStaff {
  id: string;
  displayName: string;
  jobTitle: string | null;
  teamName: string | null;
  /** Null unless the caller may see pay rates (manager and above). */
  hourlyRate: number | null;
}

export interface RosterProperty {
  id: string;
  name: string;
  colour: string | null;
}

export interface RosterWeek {
  weekStartDate: string;
  shifts: RosterShift[];
  staff: RosterStaff[];
  properties: RosterProperty[];
  /** Existing roster_periods rows, keyed by `${propertyId}` */
  periods: {
    id: string;
    propertyId: string;
    status: string;
    publishedAt: string | null;
  }[];
}

/** Load everything the manager roster screen needs for one week. */
export async function getRosterWeek(
  weekStartDate: string,
  propertyId?: string,
): Promise<RosterWeek> {
  const supabase = await createClient();
  const { fromIso, toIso } = weekRange(weekStartDate);

  let shiftQuery = supabase
    .from("shifts")
    .select(
      `id, user_id, property_id, starts_at, ends_at, status, notes,
       required_role, is_open_shift,
       properties!shifts_property_id_fkey ( name, colour ),
       teams ( name ),
       shift_breaks ( duration_minutes, is_paid ),
       shift_acknowledgements ( status )`,
    )
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso)
    .is("archived_at", null)
    .order("starts_at", { ascending: true });

  if (propertyId) shiftQuery = shiftQuery.eq("property_id", propertyId);

  const [shiftRes, staffRes, propertyRes, periodRes] = await Promise.all([
    shiftQuery,
    supabase
      .from("profiles")
      .select(
        `id, preferred_name, legal_first_name, legal_last_name, job_title,
         teams ( name ),
         employment_details ( hourly_rate )`,
      )
      .eq("is_active", true)
      .is("archived_at", null)
      .order("legal_first_name", { ascending: true }),
    supabase
      .from("properties")
      .select("id, name, colour")
      .eq("is_active", true)
      .is("archived_at", null)
      .order("name", { ascending: true }),
    supabase
      .from("roster_periods")
      .select("id, property_id, status, published_at")
      .eq("week_start_date", weekStartDate)
      .eq("is_template", false)
      .is("archived_at", null),
  ]);

  // Check EVERY query, not just the shifts. A failed staff query returning
  // an empty array renders as "no staff to roster", which is
  // indistinguishable from genuinely having none — exactly the kind of
  // silent failure that wastes an afternoon.
  for (const [label, result] of [
    ["shifts", shiftRes],
    ["staff", staffRes],
    ["properties", propertyRes],
    ["roster periods", periodRes],
  ] as const) {
    if (result.error) {
      throw new Error(`Could not load ${label}: ${result.error.message}`);
    }
  }

  return {
    weekStartDate,
    shifts: (shiftRes.data ?? []).map(mapRosterShift),
    staff: (staffRes.data ?? []).map(mapStaff),
    properties: (propertyRes.data ?? []).map((p) => ({
      id: String(p.id),
      name: String(p.name),
      colour: (p.colour as string | null) ?? null,
    })),
    periods: (periodRes.data ?? []).map((p) => ({
      id: String(p.id),
      propertyId: String(p.property_id),
      status: String(p.status),
      publishedAt: (p.published_at as string | null) ?? null,
    })),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return (value as Record<string, unknown>) ?? null;
}

function mapRosterShift(row: Record<string, unknown>): RosterShift {
  const property = asRecord(row.properties);
  const team = asRecord(row.teams);
  const rawBreaks = Array.isArray(row.shift_breaks) ? row.shift_breaks : [];
  const acks = Array.isArray(row.shift_acknowledgements)
    ? row.shift_acknowledgements
    : [];

  const breaks = rawBreaks.map((b) => ({
    durationMinutes: Number((b as Record<string, unknown>).duration_minutes ?? 0),
    isPaid: Boolean((b as Record<string, unknown>).is_paid),
  }));

  const startsAt = String(row.starts_at);
  const endsAt = String(row.ends_at);
  const ack = acks[0] as Record<string, unknown> | undefined;

  return {
    id: String(row.id),
    userId: (row.user_id as string | null) ?? null,
    propertyId: String(row.property_id),
    propertyName: property ? String(property.name) : "Unknown",
    propertyColour: property ? ((property.colour as string) ?? null) : null,
    teamName: team ? String(team.name) : null,
    startsAt,
    endsAt,
    status: String(row.status),
    notes: (row.notes as string | null) ?? null,
    requiredRole: (row.required_role as string | null) ?? null,
    isOpenShift: Boolean(row.is_open_shift),
    breaks,
    paidHours: paidHours({ startsAt, endsAt, breaks }),
    ackStatus: ack ? String(ack.status) : null,
  };
}

function mapStaff(row: Record<string, unknown>): RosterStaff {
  const team = asRecord(row.teams);
  const employment = asRecord(row.employment_details);
  const preferred = (row.preferred_name as string | null)?.trim();
  const first = String(row.legal_first_name ?? "");
  const last = String(row.legal_last_name ?? "");

  return {
    id: String(row.id),
    displayName: preferred && preferred.length > 0 ? preferred : `${first} ${last}`.trim(),
    jobTitle: (row.job_title as string | null) ?? null,
    teamName: team ? String(team.name) : null,
    // RLS returns nothing here for a supervisor, so this is null for them
    // without the query layer needing to know the rule.
    hourlyRate: employment?.hourly_rate != null ? Number(employment.hourly_rate) : null,
  };
}

/**
 * Load the context the conflict engine needs to evaluate a proposed shift
 * for one staff member.
 *
 * Deliberately looks two weeks either side: a minimum-rest breach can be
 * caused by a shift in the adjacent week, which a single-week query misses.
 */
export async function getConflictContext(
  userId: string,
  aroundIso: string,
): Promise<{
  existingShifts: CandidateShift[];
  approvedLeave: LeavePeriod[];
  availability: AvailabilityRule[];
  minimumRestHours: number;
}> {
  const supabase = await createClient();
  const around = new Date(aroundIso);
  const from = new Date(around);
  from.setDate(from.getDate() - 14);
  const to = new Date(around);
  to.setDate(to.getDate() + 14);

  const [shiftRes, leaveRes, availRes, settingsRes] = await Promise.all([
    supabase
      .from("shifts")
      .select(
        "id, user_id, property_id, starts_at, ends_at, properties!shifts_property_id_fkey ( name )",
      )
      .eq("user_id", userId)
      .gte("starts_at", from.toISOString())
      .lt("starts_at", to.toISOString())
      .is("archived_at", null),
    supabase
      .from("leave_requests")
      .select("first_date, last_date, is_partial_day, start_time, end_time")
      .eq("user_id", userId)
      .eq("status", "approved")
      .is("archived_at", null),
    supabase
      .from("staff_availability")
      .select("day_of_week, specific_date, start_time, end_time, is_available")
      .eq("user_id", userId)
      .eq("status", "approved")
      .is("archived_at", null),
    supabase.from("organisation_settings").select("minimum_rest_hours").maybeSingle(),
  ]);

  return {
    existingShifts: (shiftRes.data ?? []).map((s) => {
      const property = asRecord((s as Record<string, unknown>).properties);
      return {
        id: String(s.id),
        userId: (s.user_id as string | null) ?? null,
        propertyId: String(s.property_id),
        propertyName: property ? String(property.name) : undefined,
        startsAt: String(s.starts_at),
        endsAt: String(s.ends_at),
      };
    }),
    approvedLeave: (leaveRes.data ?? []).map((l) => ({
      firstDate: String(l.first_date),
      lastDate: String(l.last_date),
      isPartialDay: Boolean(l.is_partial_day),
      startTime: (l.start_time as string | null) ?? null,
      endTime: (l.end_time as string | null) ?? null,
    })),
    availability: (availRes.data ?? []).map((a) => ({
      dayOfWeek: a.day_of_week != null ? Number(a.day_of_week) : null,
      specificDate: (a.specific_date as string | null) ?? null,
      startTime: (a.start_time as string | null) ?? null,
      endTime: (a.end_time as string | null) ?? null,
      isAvailable: Boolean(a.is_available),
    })),
    minimumRestHours: Number(settingsRes.data?.minimum_rest_hours ?? 10),
  };
}
