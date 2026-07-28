import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  isUrgent,
  isWithinQuietHours,
  shouldPush,
  type NotificationPreferences,
} from "./policy";

const TZ = "Australia/Sydney";
/** An instant whose Sydney local time is hh:mm. */
const at = (hhmm: string) => new Date(`2026-08-05T${hhmm}:00+10:00`);

const prefs = (over: Partial<NotificationPreferences> = {}): NotificationPreferences => ({
  pushEnabled: true,
  mutedCategories: [],
  quietHoursStart: null,
  quietHoursEnd: null,
  ...over,
});

describe("isWithinQuietHours", () => {
  it("is false when no window is set", () => {
    expect(isWithinQuietHours(at("03:00"), null, null, TZ)).toBe(false);
  });

  it("handles a window that wraps midnight", () => {
    // 21:00 to 07:00 — the realistic setting, and the one a naive
    // start <= now < end comparison gets wrong.
    expect(isWithinQuietHours(at("22:30"), "21:00", "07:00", TZ)).toBe(true);
    expect(isWithinQuietHours(at("03:00"), "21:00", "07:00", TZ)).toBe(true);
    expect(isWithinQuietHours(at("06:59"), "21:00", "07:00", TZ)).toBe(true);
    expect(isWithinQuietHours(at("07:00"), "21:00", "07:00", TZ)).toBe(false);
    expect(isWithinQuietHours(at("12:00"), "21:00", "07:00", TZ)).toBe(false);
    expect(isWithinQuietHours(at("20:59"), "21:00", "07:00", TZ)).toBe(false);
  });

  it("handles a same-day window", () => {
    expect(isWithinQuietHours(at("14:00"), "13:00", "15:00", TZ)).toBe(true);
    expect(isWithinQuietHours(at("15:00"), "13:00", "15:00", TZ)).toBe(false);
    expect(isWithinQuietHours(at("12:59"), "13:00", "15:00", TZ)).toBe(false);
  });

  it("treats a zero-length window as off", () => {
    expect(isWithinQuietHours(at("09:00"), "09:00", "09:00", TZ)).toBe(false);
  });

  it("ignores an unparseable window rather than muting everything", () => {
    expect(isWithinQuietHours(at("03:00"), "not a time", "07:00", TZ)).toBe(false);
    expect(isWithinQuietHours(at("03:00"), "25:00", "07:00", TZ)).toBe(false);
  });

  it("uses the property timezone, not the server's", () => {
    // 03:00 UTC is 13:00 in Sydney — inside a 12:00-14:00 window there,
    // and outside it anywhere the server might happen to be running.
    const instant = new Date("2026-08-05T03:00:00Z");
    expect(isWithinQuietHours(instant, "12:00", "14:00", TZ)).toBe(true);
  });
});

describe("shouldPush", () => {
  it("pushes an ordinary notification when nothing is in the way", () => {
    expect(shouldPush({ category: "roster_published", preferences: prefs() })).toEqual({
      push: true,
    });
  });

  it("does not push when push is switched off", () => {
    expect(
      shouldPush({
        category: "roster_published",
        preferences: prefs({ pushEnabled: false }),
      }),
    ).toEqual({ push: false, reason: "push_disabled" });
  });

  it("does not push a muted category", () => {
    expect(
      shouldPush({
        category: "open_shift",
        preferences: prefs({ mutedCategories: ["open_shift"] }),
      }),
    ).toEqual({ push: false, reason: "muted" });
  });

  it("does not push during quiet hours", () => {
    expect(
      shouldPush({
        category: "roster_published",
        preferences: prefs({ quietHoursStart: "21:00", quietHoursEnd: "07:00" }),
        now: at("02:00"),
        timeZone: TZ,
      }),
    ).toEqual({ push: false, reason: "quiet_hours" });
  });

  it("pushes outside quiet hours", () => {
    expect(
      shouldPush({
        category: "roster_published",
        preferences: prefs({ quietHoursStart: "21:00", quietHoursEnd: "07:00" }),
        now: at("09:00"),
        timeZone: TZ,
      }),
    ).toEqual({ push: true });
  });
});

describe("urgent categories", () => {
  it("recognises only the two that genuinely cannot wait", () => {
    expect(isUrgent("urgent_notice")).toBe(true);
    expect(isUrgent("shift_cancelled")).toBe(true);
    expect(isUrgent("open_shift")).toBe(false);
    expect(isUrgent("announcement")).toBe(false);
    expect(isUrgent("roster_published")).toBe(false);
  });

  it("delivers a cancelled shift at 3am despite quiet hours", () => {
    // The difference between driving in for nothing and staying in bed.
    expect(
      shouldPush({
        category: "shift_cancelled",
        preferences: prefs({ quietHoursStart: "21:00", quietHoursEnd: "07:00" }),
        now: at("03:00"),
        timeZone: TZ,
      }),
    ).toEqual({ push: true });
  });

  it("delivers an urgent notice even when muted and push is off", () => {
    expect(
      shouldPush({
        category: "urgent_notice",
        preferences: prefs({
          pushEnabled: false,
          mutedCategories: ["urgent_notice"],
          quietHoursStart: "00:00",
          quietHoursEnd: "23:59",
        }),
        now: at("03:00"),
        timeZone: TZ,
      }),
    ).toEqual({ push: true });
  });
});

describe("DEFAULT_PREFERENCES", () => {
  it("starts with push off, since a subscription is what enables it", () => {
    expect(DEFAULT_PREFERENCES.pushEnabled).toBe(false);
    expect(DEFAULT_PREFERENCES.mutedCategories).toEqual([]);
  });
});
