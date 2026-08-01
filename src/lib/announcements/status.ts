/**
 * Announcement lifecycle and targeting.
 *
 * Pure, so the rules can be tested without a database. RLS enforces the one
 * that matters — who may see a published notice — and this decides what a
 * screen should offer and what it should say.
 */

export const ANNOUNCEMENT_CATEGORIES = [
  "general",
  "policy",
  "shift",
  "safety",
  "urgent",
] as const;
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

export const ANNOUNCEMENT_STATUSES = [
  "draft",
  "scheduled",
  "published",
  "expired",
  "withdrawn",
] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const ANNOUNCEMENT_STATUS_LABEL: Record<AnnouncementStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

const TRANSITIONS: Record<AnnouncementStatus, readonly AnnouncementStatus[]> = {
  draft: ["published", "withdrawn"],
  scheduled: ["published", "withdrawn"],
  // Withdrawing is the way to take a notice down. It is not deleted, so the
  // record of what staff were told, and when, survives.
  published: ["withdrawn"],
  expired: ["withdrawn"],
  withdrawn: [],
};

export function isAnnouncementStatus(
  value: unknown,
): value is AnnouncementStatus {
  return (
    typeof value === "string" &&
    (ANNOUNCEMENT_STATUSES as readonly string[]).includes(value)
  );
}

export function canTransition(
  from: AnnouncementStatus,
  to: AnnouncementStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Is this notice actually in front of staff right now?
 *
 * Expiry is a time, not a status, so a notice can be `published` and long
 * past its date. RLS applies the same rule, but a management screen reads
 * with a policy that does not, so it has to be checked here too.
 */
export function isLive(
  announcement: { status: AnnouncementStatus; expiresAt: string | null },
  now: Date = new Date(),
): boolean {
  if (announcement.status !== "published") return false;
  if (!announcement.expiresAt) return true;
  return Date.parse(announcement.expiresAt) > now.getTime();
}

export interface Recipient {
  allStaff: boolean;
  userId: string | null;
  teamId: string | null;
  propertyId: string | null;
}

/**
 * Which notification category a notice should be delivered under.
 *
 * `urgent_notice` is on the always-deliver list, so it reaches somebody
 * inside their quiet hours. That is the entire difference between an urgent
 * notice and a normal one, so it must follow the flag rather than the
 * category name — a notice can be about safety without being urgent.
 */
export function notificationCategoryFor(
  isUrgent: boolean,
): "urgent_notice" | "announcement" {
  return isUrgent ? "urgent_notice" : "announcement";
}

/** Plain English for who a notice went to. */
export function describeAudience(
  recipients: Recipient[],
  names: { properties?: Map<string, string>; teams?: Map<string, string> } = {},
): string {
  if (recipients.length === 0) return "Nobody";
  if (recipients.some((r) => r.allStaff)) return "All staff";

  const parts: string[] = [];
  const properties = recipients
    .map((r) => r.propertyId)
    .filter((id): id is string => Boolean(id));
  const teams = recipients
    .map((r) => r.teamId)
    .filter((id): id is string => Boolean(id));
  const people = recipients.filter((r) => r.userId).length;

  for (const id of properties) {
    parts.push(names.properties?.get(id) ?? "one property");
  }
  for (const id of teams) {
    parts.push(`${names.teams?.get(id) ?? "a team"} team`);
  }
  if (people > 0) {
    parts.push(`${people} ${people === 1 ? "person" : "people"}`);
  }

  return parts.join(", ");
}
