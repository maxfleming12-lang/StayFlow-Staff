/**
 * Role model for StayFlow Staff.
 *
 * Roles are ranked so that hierarchy questions ("is this user at least a
 * manager?") are answered by comparing ranks rather than by scattering
 * string comparisons through the codebase.
 *
 * IMPORTANT: everything in this module is a convenience for shaping the UI.
 * It is NOT the security boundary. Authorisation is enforced by Postgres
 * Row Level Security policies (see supabase/migrations) and by server-side
 * checks. A user who defeats these checks in the browser still cannot read
 * or write a row the database will not give them.
 */

/** Every role recognised by the platform, lowest privilege first. */
export const ROLES = [
  "staff",
  "supervisor",
  "manager",
  "administrator",
  "owner",
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Numeric privilege rank. Higher means more privilege.
 * Used only for "at least this role" comparisons.
 */
const ROLE_RANK: Record<Role, number> = {
  staff: 10,
  supervisor: 20,
  manager: 30,
  administrator: 40,
  owner: 50,
};

/** Human-readable label, in Australian English. */
export const ROLE_LABEL: Record<Role, string> = {
  staff: "Staff",
  supervisor: "Supervisor",
  manager: "Manager",
  administrator: "Administrator",
  owner: "Owner",
};

/** Short description of what each role may do, shown in admin screens. */
export const ROLE_DESCRIPTION: Record<Role, string> = {
  staff:
    "Access to their own roster, timesheets, requests, tasks and permitted documents.",
  supervisor:
    "Monitors assigned teams and attendance, and verifies tasks. No access to pay or employment records.",
  manager:
    "Manages assigned properties: rosters, timesheet and leave approvals, announcements, tasks and labour reports.",
  administrator:
    "Manages staff, properties, rosters, timesheets, documents, notifications and settings across the organisation.",
  owner:
    "Unrestricted access to every property, including audit logs and organisation settings.",
};

/** Type guard narrowing an untrusted string to a known Role. */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * True when `role` is at least as privileged as `minimum`.
 *
 * @example atLeast("manager", "supervisor") // true
 */
export function atLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * Roles that may administer the organisation itself — creating
 * administrators, editing organisation settings, reading audit logs.
 */
export function isOrganisationAdmin(role: Role): boolean {
  return atLeast(role, "administrator");
}

/**
 * Roles permitted to see confidential employment information such as pay
 * rates and emergency contacts. Supervisors are deliberately excluded.
 */
export function canViewConfidentialEmployment(role: Role): boolean {
  return atLeast(role, "manager");
}

/**
 * Roles permitted to manage rosters, and to approve timesheets and leave.
 */
export function canManageRosters(role: Role): boolean {
  return atLeast(role, "manager");
}
