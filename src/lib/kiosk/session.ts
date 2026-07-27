import "server-only";
import { cookies } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Kiosk device sessions.
 *
 * A kiosk is a shared tablet, so it cannot hold a staff member's session —
 * whoever picked it up would have that person's entire account. Instead a
 * manager authorises the DEVICE, and the tablet holds only a random token
 * that permits one narrow thing: clocking staff in and out at one property,
 * each punch gated by that person's own PIN.
 *
 * The token is resolved with the service-role client because there is no
 * user session for RLS to evaluate — the same situation as the iCalendar
 * feed, and treated with the same care.
 */

export const KIOSK_COOKIE = "stayflow-kiosk";

export interface KioskSession {
  id: string;
  organisationId: string;
  propertyId: string;
  propertyName: string;
}

/**
 * Resolve the kiosk session from the request cookie.
 *
 * Returns null for anything wrong — missing, unknown, revoked or expired —
 * without distinguishing them, so the cookie cannot be used to probe for
 * valid tokens.
 */
export async function getKioskSession(): Promise<KioskSession | null> {
  const store = await cookies();
  const token = store.get(KIOSK_COOKIE)?.value;

  if (!token || token.length < 32 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return null;
  }

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch {
    return null;
  }

  const { data, error } = await admin
    .from("kiosk_sessions")
    .select(
      "id, organisation_id, property_id, revoked_at, expires_at, properties ( name )",
    )
    .eq("token", token)
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at !== null) return null;
  if (new Date(String(data.expires_at)) < new Date()) return null;

  const property = Array.isArray(data.properties)
    ? data.properties[0]
    : data.properties;

  // Best-effort usage stamp; a failure must not stop staff clocking on.
  await admin
    .from("kiosk_sessions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return {
    id: String(data.id),
    organisationId: String(data.organisation_id),
    propertyId: String(data.property_id),
    propertyName: property ? String(property.name) : "this property",
  };
}

/**
 * Staff who may clock on at a kiosk's property.
 *
 * Returns names only. A kiosk screen necessarily reveals who works at a
 * property to anyone holding the tablet — that is inherent to picking your
 * name from a list — but it must reveal nothing further: no email, no
 * phone number, no role, and certainly no pay.
 */
export async function getKioskStaff(session: KioskSession): Promise<
  { id: string; displayName: string; hasPin: boolean }[]
> {
  const admin = createServiceRoleClient();

  const { data: access } = await admin
    .from("user_property_access")
    .select("user_id")
    .eq("property_id", session.propertyId);

  const ids = (access ?? []).map((a) => String(a.user_id));
  if (ids.length === 0) return [];

  const { data: people } = await admin
    .from("profiles")
    .select("id, preferred_name, legal_first_name, legal_last_name")
    .in("id", ids)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("legal_first_name", { ascending: true });

  const { data: creds } = await admin
    .from("kiosk_credentials")
    .select("user_id")
    .in("user_id", ids);

  const withPin = new Set((creds ?? []).map((c) => String(c.user_id)));

  return (people ?? []).map((p) => {
    const preferred = (p.preferred_name as string | null)?.trim();
    return {
      id: String(p.id),
      displayName:
        preferred && preferred.length > 0
          ? preferred
          : `${p.legal_first_name ?? ""} ${p.legal_last_name ?? ""}`.trim(),
      hasPin: withPin.has(String(p.id)),
    };
  });
}
