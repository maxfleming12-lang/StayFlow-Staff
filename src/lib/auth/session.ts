import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { type Role, atLeast, isRole } from "./roles";

/**
 * The signed-in user together with the profile and role information the
 * application needs in order to render. Assembled server-side only.
 */
export interface CurrentUser {
  id: string;
  email: string;
  organisationId: string;
  /** Highest role held by this user. */
  role: Role;
  preferredName: string;
  legalFirstName: string;
  legalLastName: string;
  /** Display name preferring the staff member's chosen name. */
  displayName: string;
  isActive: boolean;
  primaryPropertyId: string | null;
  /** Property IDs this user may access. Empty for org-wide roles. */
  propertyIds: string[];
}

/**
 * Load the current user, or return null when nobody is signed in.
 *
 * Wrapped in React's `cache` so that several Server Components rendering in
 * the same request share one round trip rather than each issuing their own.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();

  // getUser() verifies the JWT with Supabase. Never trust getSession() alone
  // for authorisation decisions — its contents come from a cookie.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  // RLS restricts this to the caller's own profile row.
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, organisation_id, preferred_name, legal_first_name, legal_last_name, is_active, primary_property_id, archived_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  // A user can authenticate but have no profile (invited, not yet provisioned)
  // or have been deactivated/archived. Either way they get no access.
  if (!profile || !profile.is_active || profile.archived_at) return null;

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  const roles = (roleRows ?? [])
    .map((r) => r.role)
    .filter(isRole);

  // No role means no access, rather than defaulting to something permissive.
  if (roles.length === 0) return null;

  const role = highestRole(roles);

  const { data: accessRows } = await supabase
    .from("user_property_access")
    .select("property_id")
    .eq("user_id", user.id);

  const preferred = profile.preferred_name?.trim();
  const legalFirst = profile.legal_first_name ?? "";
  const legalLast = profile.legal_last_name ?? "";

  return {
    id: user.id,
    email: user.email ?? "",
    organisationId: profile.organisation_id,
    role,
    preferredName: preferred ?? legalFirst,
    legalFirstName: legalFirst,
    legalLastName: legalLast,
    displayName: preferred && preferred.length > 0 ? preferred : legalFirst,
    isActive: profile.is_active,
    primaryPropertyId: profile.primary_property_id,
    propertyIds: (accessRows ?? []).map((r) => r.property_id),
  };
});

/** Return the most privileged role from a list. */
function highestRole(roles: Role[]): Role {
  return roles.reduce((best, r) => (atLeast(r, best) ? r : best), roles[0]);
}

/**
 * Require an authenticated, active user.
 *
 * Redirects to the login screen when there is no valid session. Call this at
 * the top of every protected Server Component or Server Action — it is the
 * server-side check that the proxy's optimistic redirect does not replace.
 *
 * @param nextPath path to return to after signing in.
 */
export async function requireUser(nextPath?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const target = nextPath
      ? `/login?next=${encodeURIComponent(nextPath)}`
      : "/login";
    redirect(target);
  }
  return user;
}

/**
 * Require an authenticated user holding at least `minimum` privilege.
 *
 * Sends users who are signed in but insufficiently privileged to the
 * access-denied screen, rather than to login, so the failure is legible.
 */
export async function requireRole(minimum: Role): Promise<CurrentUser> {
  const user = await requireUser();
  if (!atLeast(user.role, minimum)) {
    redirect("/denied");
  }
  return user;
}
