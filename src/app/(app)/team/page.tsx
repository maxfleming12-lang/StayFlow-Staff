import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getTeam } from "@/lib/team/queries";
import { TeamManager } from "@/components/team/team-manager";

export const metadata: Metadata = { title: "Team · StayFlow Staff" };
export const dynamic = "force-dynamic";

/**
 * The team.
 *
 * Supervisors and above may see who they work with; only administrators and
 * owners may add or deactivate somebody, since creating an account is what
 * grants access to everything else.
 */
export default async function TeamPage() {
  const user = await requireRole("supervisor");
  const canManage = atLeast(user.role, "administrator");

  const supabase = await createClient();
  const [team, propertyRes] = await Promise.all([
    getTeam(),
    supabase
      .from("properties")
      .select("id, name")
      .eq("is_active", true)
      .is("archived_at", null)
      .order("name"),
  ]);

  if (propertyRes.error) {
    throw new Error(`Could not load properties: ${propertyRes.error.message}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Team
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          {canManage
            ? "Add people, set what they can do, and manage access."
            : "Everyone you work with."}
        </p>
      </div>

      <TeamManager
        team={team}
        canManage={canManage}
        properties={(propertyRes.data ?? []).map((p) => ({
          id: String(p.id),
          name: String(p.name),
        }))}
      />
    </div>
  );
}
