import type { Role } from "@/lib/auth/roles";
import { atLeast } from "@/lib/auth/roles";

/**
 * Navigation model.
 *
 * `minimumRole` shapes what a user sees. It is a usability measure, not a
 * security control — every destination independently enforces its own
 * access server-side, and the database enforces it again through RLS.
 */
export interface NavItem {
  /** Stable identifier. */
  id: string;
  /** Label shown in navigation, in Australian English. */
  label: string;
  /** Short label for the mobile bottom bar, where space is tight. */
  shortLabel?: string;
  href: string;
  /** Lucide icon name, resolved by the nav components. */
  icon: NavIcon;
  /** Lowest role that may see this item. */
  minimumRole: Role;
  /** Show in the mobile bottom bar (limited to five). */
  primary?: boolean;
}

export type NavIcon =
  | "home"
  | "calendar"
  | "clock"
  | "timesheet"
  | "people"
  | "megaphone"
  | "checklist"
  | "folder"
  | "chart"
  | "settings"
  | "swap";

/** Every destination in the application, in navigation order. */
export const NAV_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    shortLabel: "Home",
    href: "/",
    icon: "home",
    minimumRole: "staff",
    primary: true,
  },
  {
    id: "roster",
    label: "My roster",
    shortLabel: "Roster",
    href: "/roster",
    icon: "calendar",
    minimumRole: "staff",
    primary: true,
  },
  {
    id: "clock",
    label: "Time clock",
    shortLabel: "Clock",
    href: "/clock",
    icon: "clock",
    minimumRole: "staff",
    primary: true,
  },
  {
    id: "timesheets",
    label: "My timesheets",
    shortLabel: "Hours",
    href: "/timesheets",
    icon: "timesheet",
    minimumRole: "staff",
    primary: true,
  },
  {
    id: "available-shifts",
    label: "Available shifts",
    shortLabel: "Cover",
    href: "/available-shifts",
    icon: "swap",
    minimumRole: "staff",
  },
  {
    id: "tasks",
    label: "Tasks",
    href: "/tasks",
    icon: "checklist",
    minimumRole: "staff",
  },
  {
    id: "announcements",
    label: "Announcements",
    href: "/announcements",
    icon: "megaphone",
    minimumRole: "staff",
  },
  {
    id: "documents",
    label: "Documents",
    href: "/documents",
    icon: "folder",
    minimumRole: "staff",
  },
  {
    id: "manage-roster",
    label: "Manage roster",
    href: "/manage/roster",
    icon: "calendar",
    minimumRole: "manager",
  },
  {
    id: "manage-leave",
    label: "Leave requests",
    href: "/manage/leave",
    icon: "calendar",
    minimumRole: "manager",
  },
  {
    id: "manage-availability",
    label: "Availability",
    href: "/manage/availability",
    icon: "calendar",
    minimumRole: "manager",
  },
  {
    id: "manage-replacements",
    label: "Shift cover",
    href: "/manage/replacements",
    icon: "swap",
    minimumRole: "manager",
  },
  {
    id: "team",
    label: "Team",
    href: "/team",
    icon: "people",
    minimumRole: "supervisor",
  },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    icon: "chart",
    minimumRole: "manager",
  },
  {
    id: "settings",
    label: "Settings",
    shortLabel: "More",
    href: "/settings",
    icon: "settings",
    minimumRole: "staff",
    primary: true,
  },
];

/** Navigation items visible to the given role. */
export function navItemsFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => atLeast(role, item.minimumRole));
}

/** The (at most five) items shown in the mobile bottom bar. */
export function primaryNavItemsFor(role: Role): NavItem[] {
  return navItemsFor(role)
    .filter((item) => item.primary)
    .slice(0, 5);
}

/**
 * Decide whether a nav link should render as current.
 *
 * The dashboard matches only an exact "/", since every path starts with it.
 */
export function isActivePath(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
