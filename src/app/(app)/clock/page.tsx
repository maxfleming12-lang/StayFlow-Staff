import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { getClockState } from "@/lib/clock/actions";
import { summariseWorkedTime } from "@/lib/clock/state";
import { createClient } from "@/lib/supabase/server";
import { formatHours, formatTime } from "@/lib/format";
import { ClockPanel } from "@/components/clock/clock-panel";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Time clock · StayFlow Staff",
};

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  clock_in: "Clocked in",
  break_start: "Break started",
  break_end: "Break ended",
  clock_out: "Clocked out",
};

/**
 * Time clock.
 *
 * The property defaults to the shift the person is currently on, falling
 * back to their primary property — someone clocking in should not have to
 * tell the system where they work.
 */
export default async function ClockPage() {
  const user = await requireUser();
  const { state, events } = await getClockState();
  const summary = summariseWorkedTime(events);

  const supabase = await createClient();

  // Today's published shift, used to pre-select the property and to attach
  // the events to the right shift for timesheet reconciliation later.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const { data: todayShift } = await supabase
    .from("shifts")
    .select("id, property_id, starts_at, ends_at, properties!shifts_property_id_fkey ( name )")
    .eq("status", "published")
    .is("archived_at", null)
    .gte("starts_at", dayStart.toISOString())
    .lt("starts_at", dayEnd.toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: fallbackProperty } = await supabase
    .from("properties")
    .select("id, name")
    .eq("id", user.primaryPropertyId ?? "")
    .maybeSingle();

  const shiftProperty = todayShift
    ? (Array.isArray(todayShift.properties)
        ? todayShift.properties[0]
        : todayShift.properties)
    : null;

  const propertyId =
    (todayShift?.property_id as string | undefined) ??
    fallbackProperty?.id ??
    null;
  const propertyName =
    (shiftProperty?.name as string | undefined) ??
    fallbackProperty?.name ??
    "your property";

  return (
    <div className="mx-auto max-w-md space-y-5">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
        Time clock
      </h1>

      {propertyId ? (
        <ClockPanel
          state={state}
          propertyId={propertyId}
          propertyName={propertyName}
          shiftId={(todayShift?.id as string | undefined) ?? null}
        />
      ) : (
        <Alert tone="warning" title="No property assigned">
          Your account is not linked to a property yet, so you cannot clock in.
          Ask your manager to assign you one.
        </Alert>
      )}

      {todayShift && (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          Rostered today {formatTime(String(todayShift.starts_at))} –{" "}
          {formatTime(String(todayShift.ends_at))}
        </p>
      )}

      {events.length > 0 && (
        <section
          aria-labelledby="today-heading"
          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-baseline justify-between">
            <h2
              id="today-heading"
              className="text-sm font-semibold text-slate-900 dark:text-slate-100"
            >
              Today so far
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {formatHours(summary.workedMinutes / 60)}
              {summary.breakMinutes > 0 && (
                <span className="text-slate-500">
                  {" "}
                  · {summary.breakMinutes} min break
                </span>
              )}
            </p>
          </div>

          {summary.anomalies.length > 0 && (
            <div className="mt-3 space-y-2">
              {summary.anomalies.map((note) => (
                <Alert key={note} tone="warning">
                  {note} Your manager will sort this out when approving your
                  hours.
                </Alert>
              ))}
            </div>
          )}

          <ol className="mt-3 space-y-1.5">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex justify-between gap-3 text-sm text-slate-600 dark:text-slate-400"
              >
                <span>{EVENT_LABEL[event.eventType] ?? event.eventType}</span>
                <span className="tabular-nums">
                  {formatTime(event.serverTime)}
                </span>
              </li>
            ))}
          </ol>

          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            These entries cannot be edited or deleted by anyone, including
            management. Corrections are made on your timesheet, with a reason,
            leaving the original record intact.
          </p>
        </section>
      )}
    </div>
  );
}
