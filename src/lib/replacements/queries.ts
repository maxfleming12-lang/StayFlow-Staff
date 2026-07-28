import { createClient } from "@/lib/supabase/server";

/**
 * Replacement and open-shift queries.
 *
 * RLS scopes everything: staff see their own requests and offers directed
 * at them, managers see requests for their properties.
 */

export interface ReplacementRequest {
  id: string;
  shiftId: string;
  requestedBy: string;
  requesterName: string;
  reason: string | null;
  status: string;
  replacementUserId: string | null;
  replacementName: string | null;
  managerNote: string | null;
  createdAt: string;
  shift: {
    startsAt: string;
    endsAt: string;
    propertyId: string;
    propertyName: string;
    propertyColour: string | null;
  } | null;
}

export interface OpenShift {
  id: string;
  startsAt: string;
  endsAt: string;
  propertyName: string;
  propertyColour: string | null;
  requiredRole: string | null;
  notes: string | null;
  paidHours: number;
  /** The caller's own offer row, when one exists. */
  myOffer: { id: string; status: string; claimedByMe: boolean } | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return (value as Record<string, unknown>) ?? null;
}

function nameOf(profile: Record<string, unknown> | null): string {
  if (!profile) return "Unknown";
  const preferred = (profile.preferred_name as string | null)?.trim();
  if (preferred) return preferred;
  return (
    `${profile.legal_first_name ?? ""} ${profile.legal_last_name ?? ""}`.trim() ||
    "Unknown"
  );
}

const REPLACEMENT_SELECT = `id, shift_id, requested_by, reason, status,
  replacement_user_id, manager_note, created_at,
  requester:profiles!shift_replacement_requests_profile_fk (
    preferred_name, legal_first_name, legal_last_name ),
  shifts (
    starts_at, ends_at, property_id,
    properties!shifts_property_id_fkey ( name, colour ) )`;

function mapReplacement(row: Record<string, unknown>): ReplacementRequest {
  const shiftRow = asRecord(row.shifts);
  const property = shiftRow ? asRecord(shiftRow.properties) : null;

  return {
    id: String(row.id),
    shiftId: String(row.shift_id),
    requestedBy: String(row.requested_by),
    requesterName: nameOf(asRecord(row.requester)),
    reason: (row.reason as string | null) ?? null,
    status: String(row.status),
    replacementUserId: (row.replacement_user_id as string | null) ?? null,
    replacementName: null,
    managerNote: (row.manager_note as string | null) ?? null,
    createdAt: String(row.created_at),
    shift: shiftRow
      ? {
          startsAt: String(shiftRow.starts_at),
          endsAt: String(shiftRow.ends_at),
          propertyId: String(shiftRow.property_id),
          propertyName: property ? String(property.name) : "Unknown",
          propertyColour: property
            ? ((property.colour as string) ?? null)
            : null,
        }
      : null,
  };
}

/** The signed-in staff member's own replacement requests. */
export async function getMyReplacementRequests(): Promise<
  ReplacementRequest[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shift_replacement_requests")
    .select(REPLACEMENT_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Could not load your requests: ${error.message}`);
  }
  return (data ?? []).map(mapReplacement);
}

/** Replacement requests a manager needs to act on. */
export async function getReplacementsForReview(
  onlyOpen = true,
): Promise<ReplacementRequest[]> {
  const supabase = await createClient();

  let query = supabase
    .from("shift_replacement_requests")
    .select(REPLACEMENT_SELECT)
    .order("created_at", { ascending: true });

  if (onlyOpen) {
    query = query.in("status", ["requested", "offered", "claimed"]);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Could not load replacement requests: ${error.message}`);
  }

  const requests = (data ?? []).map(mapReplacement);

  // Resolve claimant names in one query rather than per row.
  const claimantIds = [
    ...new Set(requests.map((r) => r.replacementUserId).filter(Boolean)),
  ] as string[];

  if (claimantIds.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, preferred_name, legal_first_name, legal_last_name")
      .in("id", claimantIds);

    const byId = new Map(
      (people ?? []).map((p) => [String(p.id), nameOf(p as Record<string, unknown>)]),
    );
    for (const request of requests) {
      if (request.replacementUserId) {
        request.replacementName = byId.get(request.replacementUserId) ?? null;
      }
    }
  }

  return requests;
}

/**
 * Shifts the signed-in staff member could pick up.
 *
 * Driven by `open_shift_offers`, NOT by `shifts.is_open_shift`. That
 * distinction matters: a shift being handed over stays assigned to the
 * person giving it away until a manager approves the swap, so it is never
 * "open" in the column sense. Keying off the shift flag made every
 * replacement offer invisible to the people who could actually take it.
 *
 * Two sources are merged:
 *   * offers — a manager has explicitly put a shift up for cover
 *   * genuinely unassigned open shifts, which a manager may create directly
 *
 * RLS decides which offers are visible (directed at this user, or open to
 * everyone at a property they may work at), so no recipient filter is
 * written here.
 */
export async function getAvailableShifts(): Promise<OpenShift[]> {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const SHIFT_FIELDS = `id, starts_at, ends_at, required_role, notes,
       properties!shifts_property_id_fkey ( name, colour ),
       shift_breaks ( duration_minutes, is_paid )`;

  const [offerRes, openRes] = await Promise.all([
    supabase
      .from("open_shift_offers")
      .select(`id, status, claimed_by, shifts ( ${SHIFT_FIELDS} )`)
      .in("status", ["offered", "claimed"])
      .order("created_at", { ascending: true }),
    supabase
      .from("shifts")
      .select(SHIFT_FIELDS)
      .eq("is_open_shift", true)
      .eq("status", "published")
      .is("user_id", null)
      .is("archived_at", null)
      .gte("starts_at", nowIso)
      .order("starts_at", { ascending: true }),
  ]);

  for (const [label, result] of [
    ["offers", offerRes],
    ["open shifts", openRes],
  ] as const) {
    if (result.error) {
      throw new Error(`Could not load ${label}: ${result.error.message}`);
    }
  }

  const { paidHours } = await import("@/lib/roster/hours");

  const toOpenShift = (
    shiftRow: Record<string, unknown>,
    offer: Record<string, unknown> | null,
  ): OpenShift => {
    const property = asRecord(shiftRow.properties);
    const rawBreaks = Array.isArray(shiftRow.shift_breaks)
      ? shiftRow.shift_breaks
      : [];
    const breaks = rawBreaks.map((b) => ({
      durationMinutes: Number(
        (b as Record<string, unknown>).duration_minutes ?? 0,
      ),
      isPaid: Boolean((b as Record<string, unknown>).is_paid),
    }));

    return {
      id: String(shiftRow.id),
      startsAt: String(shiftRow.starts_at),
      endsAt: String(shiftRow.ends_at),
      propertyName: property ? String(property.name) : "Unknown",
      propertyColour: property ? ((property.colour as string) ?? null) : null,
      requiredRole: (shiftRow.required_role as string | null) ?? null,
      notes: (shiftRow.notes as string | null) ?? null,
      paidHours: paidHours({
        startsAt: String(shiftRow.starts_at),
        endsAt: String(shiftRow.ends_at),
        breaks,
      }),
      myOffer: offer
        ? {
            id: String(offer.id),
            status: String(offer.status),
            claimedByMe: offer.claimed_by != null,
          }
        : null,
    };
  };

  const results: OpenShift[] = [];
  const seen = new Set<string>();

  for (const offer of offerRes.data ?? []) {
    const shiftRow = asRecord((offer as Record<string, unknown>).shifts);
    if (!shiftRow) continue;
    // A shift that has already started is no longer worth offering.
    if (String(shiftRow.starts_at) < nowIso) continue;

    const mapped = toOpenShift(shiftRow, offer as Record<string, unknown>);
    if (seen.has(mapped.id)) continue;
    seen.add(mapped.id);
    results.push(mapped);
  }

  for (const shiftRow of openRes.data ?? []) {
    const mapped = toOpenShift(shiftRow as Record<string, unknown>, null);
    if (seen.has(mapped.id)) continue;
    seen.add(mapped.id);
    results.push(mapped);
  }

  return results.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
