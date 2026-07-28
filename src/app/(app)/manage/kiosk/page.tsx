import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { KioskAdmin } from "@/components/kiosk/kiosk-admin";

export const metadata: Metadata = {
  title: "Kiosk devices · StayFlow Staff",
};

export const dynamic = "force-dynamic";

/**
 * Kiosk administration.
 *
 * Note what is NOT selected: the `token` column. RLS cannot hide a column,
 * so the query must simply never ask for it — a token is shown once, when
 * the device is authorised, and is not retrievable afterwards.
 */
export default async function ManageKioskPage() {
  await requireRole("manager");
  const supabase = await createClient();

  const [propertyRes, deviceRes, staffRes, credRes] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name")
      .eq("is_active", true)
      .is("archived_at", null)
      .order("name"),
    supabase
      .from("kiosk_sessions")
      .select("id, device_label, expires_at, last_used_at, properties ( name )")
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, preferred_name, legal_first_name, legal_last_name")
      .eq("is_active", true)
      .is("archived_at", null)
      .order("legal_first_name"),
    supabase.from("kiosk_credentials").select("user_id"),
  ]);

  for (const [label, result] of [
    ["properties", propertyRes],
    ["devices", deviceRes],
    ["staff", staffRes],
  ] as const) {
    if (result.error) {
      throw new Error(`Could not load ${label}: ${result.error.message}`);
    }
  }

  // kiosk_credentials has no client policies, so this returns nothing for a
  // manager. That is intended — the PIN table is server-only — so "has a
  // PIN" is simply not shown rather than being wrong.
  const withPin = new Set(
    (credRes.data ?? []).map((c) => String(c.user_id)),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Kiosk devices
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Shared tablets that staff clock on from with a PIN.
        </p>
      </div>

      <KioskAdmin
        properties={(propertyRes.data ?? []).map((p) => ({
          id: String(p.id),
          name: String(p.name),
        }))}
        devices={(deviceRes.data ?? []).map((d) => {
          const property = Array.isArray(d.properties)
            ? d.properties[0]
            : d.properties;
          return {
            id: String(d.id),
            label: (d.device_label as string | null) ?? null,
            propertyName: property ? String(property.name) : "Unknown",
            expiresAt: String(d.expires_at),
            lastUsedAt: (d.last_used_at as string | null) ?? null,
          };
        })}
        staff={(staffRes.data ?? []).map((p) => {
          const preferred = (p.preferred_name as string | null)?.trim();
          return {
            id: String(p.id),
            displayName:
              preferred && preferred.length > 0
                ? preferred
                : `${p.legal_first_name ?? ""} ${p.legal_last_name ?? ""}`.trim(),
            hasPin: withPin.has(String(p.id)),
          };
        })}
      />
    </div>
  );
}
