import { createClient } from "@/lib/supabase/server";
import { paidHours } from "./hours";

/**
 * Server-side roster queries.
 *
 * Every query here runs as the signed-in user, so Row Level Security decides
 * what comes back. None of these functions need their own permission checks
 * for *reads* — a staff member simply receives their own rows. That is the
 * point of enforcing in the database rather than in the query layer.
 */

/** One shift as the staff roster screen needs it. */
export interface StaffShift {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  notes: string | null;
  propertyName: string;
  propertyColour: string | null;
  teamName: string | null;
  breaks: { durationMinutes: number; isPaid: boolean }[];
  /** Estimated paid hours after unpaid breaks. */
  paidHours: number;
  acknowledgement: {
    status: string;
    decisionRequired: boolean;
  } | null;
}

/**
 * Load a staff member's published shifts from `from` onwards.
 *
 * Draft shifts are invisible to staff by policy, so no status filter is
 * needed here — the database will not return them.
 */
export async function getMyShifts(
  fromIso: string,
  toIso?: string,
): Promise<StaffShift[]> {
  const supabase = await createClient();

  let query = supabase
    .from("shifts")
    .select(
      `id, starts_at, ends_at, status, notes,
       properties!shifts_property_id_fkey ( name, colour ),
       teams ( name ),
       shift_breaks ( duration_minutes, is_paid ),
       shift_acknowledgements ( status )`,
    )
    .gte("starts_at", fromIso)
    .order("starts_at", { ascending: true });

  if (toIso) query = query.lt("starts_at", toIso);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load roster: ${error.message}`);

  return (data ?? []).map(mapShift);
}

/** Shape a database row into the screen's view model. */
function mapShift(row: Record<string, unknown>): StaffShift {
  const property = asRecord(row.properties);
  const team = asRecord(row.teams);
  const breaks = Array.isArray(row.shift_breaks) ? row.shift_breaks : [];
  const acks = Array.isArray(row.shift_acknowledgements)
    ? row.shift_acknowledgements
    : [];

  const mappedBreaks = breaks.map((b) => ({
    durationMinutes: Number((b as Record<string, unknown>).duration_minutes ?? 0),
    isPaid: Boolean((b as Record<string, unknown>).is_paid),
  }));

  const startsAt = String(row.starts_at);
  const endsAt = String(row.ends_at);
  const ack = acks[0] as Record<string, unknown> | undefined;
  const ackStatus = ack ? String(ack.status) : null;

  return {
    id: String(row.id),
    startsAt,
    endsAt,
    status: String(row.status),
    notes: (row.notes as string | null) ?? null,
    propertyName: property ? String(property.name) : "Unknown property",
    propertyColour: property ? ((property.colour as string) ?? null) : null,
    teamName: team ? String(team.name) : null,
    breaks: mappedBreaks,
    paidHours: paidHours({ startsAt, endsAt, breaks: mappedBreaks }),
    acknowledgement: ackStatus
      ? {
          status: ackStatus,
          // Only pending and viewed still need a decision from the staff
          // member; accepted and declined are settled.
          decisionRequired: ackStatus === "pending" || ackStatus === "viewed",
        }
      : null,
  };
}

/** Narrow an embedded PostgREST relation to a single record. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return (value[0] as Record<string, unknown>) ?? null;
  }
  return (value as Record<string, unknown>) ?? null;
}

/**
 * Split shifts into the three groups the staff screen shows.
 *
 * "Today" uses the property timezone rather than the device's, so a staff
 * member checking their phone while travelling still sees the motel's day.
 */
export function groupShifts(
  shifts: StaffShift[],
  now: Date = new Date(),
  timeZone = "Australia/Sydney",
): { today: StaffShift[]; thisWeek: StaffShift[]; upcoming: StaffShift[] } {
  const todayKey = dateKey(now, timeZone);
  const weekEnd = endOfWeek(now, timeZone);

  const today: StaffShift[] = [];
  const thisWeek: StaffShift[] = [];
  const upcoming: StaffShift[] = [];

  for (const shift of shifts) {
    const start = new Date(shift.startsAt);
    if (dateKey(start, timeZone) === todayKey) today.push(shift);
    else if (start < weekEnd) thisWeek.push(shift);
    else upcoming.push(shift);
  }

  return { today, thisWeek, upcoming };
}

/** Local yyyy-mm-dd for an instant. */
function dateKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(d);
}

/**
 * The instant the current week ends.
 *
 * Australian rosters run Monday to Sunday, so the week ends at the start of
 * the following Monday.
 */
function endOfWeek(now: Date, timeZone: string): Date {
  const weekday = new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    timeZone,
  }).format(now);
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(
    weekday.slice(0, 3),
  );
  const daysRemaining = 7 - (index < 0 ? 0 : index);
  const end = new Date(now);
  end.setDate(end.getDate() + daysRemaining);
  end.setHours(0, 0, 0, 0);
  return end;
}
