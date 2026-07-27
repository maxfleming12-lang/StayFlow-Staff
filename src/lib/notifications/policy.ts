/**
 * Whether a notification should be pushed to a device right now.
 *
 * A notification is always RECORDED — it appears in the app whatever the
 * settings say. This decides only whether to interrupt someone's evening
 * with it. Getting that backwards would mean a muted category silently
 * losing information the staff member still needs to see.
 */

export type NotificationCategory =
  | "roster_published"
  | "shift_changed"
  | "shift_cancelled"
  | "shift_ack_reminder"
  | "open_shift"
  | "replacement_update"
  | "leave_update"
  | "availability_update"
  | "timesheet_correction"
  | "timesheet_approval_reminder"
  | "announcement"
  | "urgent_notice"
  | "task_assigned"
  | "task_due"
  | "document_ack";

export interface NotificationPreferences {
  pushEnabled: boolean;
  mutedCategories: string[];
  /** Local "HH:MM", inclusive start of the do-not-disturb window. */
  quietHoursStart: string | null;
  /** Local "HH:MM", exclusive end. */
  quietHoursEnd: string | null;
}

export type PushDecision =
  | { push: true }
  | { push: false; reason: "push_disabled" | "muted" | "quiet_hours" };

/**
 * Categories that ignore quiet hours and muting.
 *
 * Deliberately tiny. A shift cancelled at 6am is the difference between
 * someone driving in for nothing and staying in bed, and an urgent notice
 * is by definition the thing you would want waking you. Everything else can
 * wait until morning — a motel worker who has muted "open shifts" does not
 * want a 2am buzz offering one.
 */
const ALWAYS_DELIVER: ReadonlySet<string> = new Set([
  "urgent_notice",
  "shift_cancelled",
]);

export function isUrgent(category: string): boolean {
  return ALWAYS_DELIVER.has(category);
}

/** Minutes since local midnight for "HH:MM". Null when unparseable. */
function toMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Is `now` inside the quiet window?
 *
 * The window normally wraps midnight — 21:00 to 07:00 — so a naive
 * start <= now < end comparison is wrong for every realistic setting.
 */
export function isWithinQuietHours(
  now: Date,
  start: string | null,
  end: string | null,
  timeZone = "Australia/Sydney",
): boolean {
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === null || to === null) return false;
  // A zero-length window means quiet hours are effectively off.
  if (from === to) return false;

  const local = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(now);
  const current = toMinutes(local);
  if (current === null) return false;

  return from < to
    ? current >= from && current < to
    : // Wraps midnight: inside if after the start OR before the end.
      current >= from || current < to;
}

/** Decide whether to send a push for this notification. */
export function shouldPush(input: {
  category: string;
  preferences: NotificationPreferences;
  now?: Date;
  timeZone?: string;
}): PushDecision {
  const { category, preferences } = input;

  // Urgent categories bypass every preference, including push_enabled.
  if (isUrgent(category)) return { push: true };

  if (!preferences.pushEnabled) return { push: false, reason: "push_disabled" };

  if (preferences.mutedCategories.includes(category)) {
    return { push: false, reason: "muted" };
  }

  if (
    isWithinQuietHours(
      input.now ?? new Date(),
      preferences.quietHoursStart,
      preferences.quietHoursEnd,
      input.timeZone,
    )
  ) {
    return { push: false, reason: "quiet_hours" };
  }

  return { push: true };
}

/** Sensible defaults for someone who has never opened their settings. */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  // Off until the person explicitly grants permission and subscribes; a
  // subscription is what actually enables delivery.
  pushEnabled: false,
  mutedCategories: [],
  quietHoursStart: null,
  quietHoursEnd: null,
};

/** Human labels for the settings screen. */
export const CATEGORY_LABELS: Record<string, string> = {
  roster_published: "Roster published",
  shift_changed: "Shift changed",
  shift_cancelled: "Shift cancelled",
  shift_ack_reminder: "Reminder to accept a shift",
  open_shift: "A shift needs cover",
  replacement_update: "Replacement updates",
  leave_update: "Leave decisions",
  availability_update: "Availability decisions",
  timesheet_correction: "Timesheet corrections",
  timesheet_approval_reminder: "Timesheet reminders",
  announcement: "Announcements",
  urgent_notice: "Urgent notices",
  task_assigned: "Tasks assigned to you",
  task_due: "Tasks due",
  document_ack: "Documents to acknowledge",
};
