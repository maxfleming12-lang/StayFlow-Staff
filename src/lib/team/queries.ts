import { createClient } from "@/lib/supabase/server";

/** One person on the team, as the team screen needs them. */
export interface TeamMember {
  id: string;
  displayName: string;
  fullName: string;
  email: string;
  jobTitle: string | null;
  mobile: string | null;
  role: string;
  isActive: boolean;
  propertyNames: string[];
  isKioskOnly: boolean;
}

/**
 * Everyone in the organisation.
 *
 * RLS decides visibility: `profiles_select_colleagues` gives supervisors and
 * above the roster of who they work with. Pay and employment details live in
 * separate tables with stricter policies and are deliberately not read here.
 */
export async function getTeam(): Promise<TeamMember[]> {
  const supabase = await createClient();

  const [profileRes, roleRes, accessRes] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, preferred_name, legal_first_name, legal_last_name, email, job_title, mobile_number, is_active",
      )
      .is("archived_at", null)
      .order("is_active", { ascending: false })
      .order("legal_first_name", { ascending: true }),
    supabase.from("user_roles").select("user_id, role"),
    supabase
      .from("user_property_access")
      .select("user_id, properties ( name )"),
  ]);

  for (const [label, result] of [
    ["team", profileRes],
    ["roles", roleRes],
    ["property access", accessRes],
  ] as const) {
    if (result.error) {
      throw new Error(`Could not load ${label}: ${result.error.message}`);
    }
  }

  // Highest role wins when somebody holds more than one.
  const RANK = ["staff", "supervisor", "manager", "administrator", "owner"];
  const roleByUser = new Map<string, string>();
  for (const row of roleRes.data ?? []) {
    const current = roleByUser.get(String(row.user_id));
    const next = String(row.role);
    if (!current || RANK.indexOf(next) > RANK.indexOf(current)) {
      roleByUser.set(String(row.user_id), next);
    }
  }

  const propertiesByUser = new Map<string, string[]>();
  for (const row of accessRes.data ?? []) {
    const property = Array.isArray(row.properties)
      ? row.properties[0]
      : row.properties;
    if (!property) continue;
    const key = String(row.user_id);
    propertiesByUser.set(key, [
      ...(propertiesByUser.get(key) ?? []),
      String(property.name),
    ]);
  }

  return (profileRes.data ?? []).map((p) => {
    const preferred = (p.preferred_name as string | null)?.trim();
    const fullName = `${p.legal_first_name ?? ""} ${p.legal_last_name ?? ""}`.trim();
    return {
      id: String(p.id),
      displayName: preferred && preferred.length > 0 ? preferred : fullName,
      fullName,
      email: String(p.email ?? ""),
      jobTitle: (p.job_title as string | null) ?? null,
      mobile: (p.mobile_number as string | null) ?? null,
      role: roleByUser.get(String(p.id)) ?? "staff",
      isActive: Boolean(p.is_active),
      propertyNames: propertiesByUser.get(String(p.id)) ?? [],
      isKioskOnly: String(p.email ?? "").endsWith("@staff.stayflow.invalid"),
    };
  });
}
