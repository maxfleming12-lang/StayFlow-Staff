import { createServiceRoleClient } from "@/lib/supabase/server";
import { buildCalendar, type CalendarEvent } from "@/lib/calendar/ics";

/**
 * Private iCalendar feed for one staff member's published roster.
 *
 * This route is UNAUTHENTICATED by necessity — Apple Calendar, Google
 * Calendar and Outlook subscribe over plain HTTPS with no session. The token
 * in the URL is therefore the credential, which drives every decision here:
 *
 *   * The token is resolved with the service-role client, because there is
 *     no user session to evaluate RLS against. Everything the route returns
 *     is then filtered explicitly by the resolved user_id — the one place in
 *     this codebase where scoping is written by hand rather than delegated
 *     to the database, and so the one place worth reading carefully.
 *   * A missing, malformed, revoked or unknown token all return the SAME
 *     404 with no body. Distinguishing them would let someone probe for
 *     valid tokens, and confirm that a revoked one had once existed.
 *   * Only PUBLISHED shifts are returned, and only that person's own. No
 *     colleague names, pay rates, notes about other staff, or draft roster
 *     content ever reach this response.
 *   * Responses are marked private and no-store: a calendar feed URL is a
 *     bearer credential and must not sit in a shared cache.
 */

export const dynamic = "force-dynamic";

/** Every failure looks identical from outside. */
function notFound(): Response {
  return new Response(null, { status: 404 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Cheap shape check before touching the database. Tokens are 32 random
  // bytes base64url-encoded, so anything else cannot be one.
  if (!token || token.length < 32 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return notFound();
  }

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch {
    // Misconfigured server: do not leak that detail to an anonymous caller.
    return notFound();
  }

  const { data: tokenRow, error: tokenError } = await admin
    .from("calendar_tokens")
    .select("user_id, organisation_id, revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (tokenError || !tokenRow || tokenRow.revoked_at !== null) {
    return notFound();
  }

  const userId = tokenRow.user_id;

  // An inactive or archived staff member's feed stops working immediately,
  // matching the rule that disabling an account revokes access at once.
  const { data: profile } = await admin
    .from("profiles")
    .select("preferred_name, legal_first_name, is_active, archived_at")
    .eq("id", userId)
    .maybeSingle();

  if (!profile || !profile.is_active || profile.archived_at !== null) {
    return notFound();
  }

  // Roughly three months back and a year forward: enough history for a
  // calendar to look sensible, without shipping years of shifts every poll.
  const from = new Date();
  from.setMonth(from.getMonth() - 3);
  const to = new Date();
  to.setFullYear(to.getFullYear() + 1);

  const { data: shifts, error: shiftError } = await admin
    .from("shifts")
    .select(
      `id, starts_at, ends_at, notes,
       properties!shifts_property_id_fkey ( name, address )`,
    )
    // Scoped by hand because there is no session for RLS to use.
    .eq("user_id", userId)
    .eq("status", "published")
    .is("archived_at", null)
    .gte("starts_at", from.toISOString())
    .lte("starts_at", to.toISOString())
    .order("starts_at", { ascending: true });

  if (shiftError) return notFound();

  const events: CalendarEvent[] = (shifts ?? []).map((shift) => {
    const property = Array.isArray(shift.properties)
      ? shift.properties[0]
      : shift.properties;
    const propertyName = property ? String(property.name) : "Shift";

    return {
      // Stable per shift, so an edited shift updates in place rather than
      // appearing twice in the subscriber's calendar.
      uid: `shift-${shift.id}@stayflow-staff`,
      startsAt: String(shift.starts_at),
      endsAt: String(shift.ends_at),
      summary: propertyName,
      location: property?.address ? String(property.address) : null,
      description: shift.notes ? String(shift.notes) : null,
    };
  });

  const displayName =
    (profile.preferred_name as string | null)?.trim() ||
    String(profile.legal_first_name ?? "");

  const body = buildCalendar({
    calendarName: displayName ? `${displayName} — StayFlow roster` : "StayFlow roster",
    events,
  });

  // Best-effort usage stamp; a failure here must not break the feed.
  await admin
    .from("calendar_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("token", token);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="stayflow-roster.ics"',
      // A feed URL is a bearer credential — never let a shared cache hold it.
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      // This response is data for a calendar client, never a page.
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
