/**
 * Leave duration arithmetic.
 *
 * Like everything else in StayFlow, these are ESTIMATES for planning. They
 * are not an entitlement calculation and take no account of accruals,
 * public holidays or award rules.
 */

import { parseIsoDate } from "@/lib/roster/week";

/** Whole days between two ISO dates, inclusive of both ends. */
export function inclusiveDays(firstDate: string, lastDate: string): number {
  const first = parseIsoDate(firstDate);
  const last = parseIsoDate(lastDate);
  const ms = last.getTime() - first.getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

/** Count only Monday–Friday within the range. */
export function weekdaysBetween(firstDate: string, lastDate: string): number {
  const first = parseIsoDate(firstDate);
  const total = inclusiveDays(firstDate, lastDate);
  let count = 0;
  for (let i = 0; i < total; i += 1) {
    const day = new Date(first);
    day.setDate(day.getDate() + i);
    const dow = day.getDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

/**
 * Suggested total hours for a leave request.
 *
 * For partial-day leave this is the time range itself. For whole-day leave
 * it is weekdays multiplied by a standard day, defaulting to 7.6 hours —
 * the usual Australian full-time day of a 38-hour week.
 *
 * A motel runs seven days, so weekday-only counting is a rough default the
 * staff member can override, not an assertion about when they work.
 */
export function suggestedHours(input: {
  firstDate: string;
  lastDate: string;
  isPartialDay: boolean;
  startTime?: string | null;
  endTime?: string | null;
  standardDayHours?: number;
}): number | null {
  if (input.isPartialDay) {
    if (!input.startTime || !input.endTime) return null;
    const [sh, sm] = input.startTime.split(":").map(Number);
    const [eh, em] = input.endTime.split(":").map(Number);
    const minutes = eh * 60 + em - (sh * 60 + sm);
    if (minutes <= 0) return null;
    return Math.round((minutes / 60) * 100) / 100;
  }

  const perDay = input.standardDayHours ?? 7.6;
  const days = weekdaysBetween(input.firstDate, input.lastDate);
  return Math.round(days * perDay * 100) / 100;
}

/** Human label for a leave category. */
export const LEAVE_CATEGORIES = [
  { value: "annual", label: "Annual leave" },
  { value: "personal", label: "Personal / sick leave" },
  { value: "carers", label: "Carer's leave" },
  { value: "compassionate", label: "Compassionate leave" },
  { value: "parental", label: "Parental leave" },
  { value: "long_service", label: "Long service leave" },
  { value: "community_service", label: "Community service leave" },
  { value: "unpaid", label: "Unpaid leave" },
  { value: "other", label: "Other" },
] as const;

export type LeaveCategory = (typeof LEAVE_CATEGORIES)[number]["value"];

/** Look up the display label for a stored category value. */
export function leaveCategoryLabel(value: string): string {
  return LEAVE_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}
