"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  approveTimesheets,
  generateTimesheets,
  type TimesheetActionState,
} from "@/lib/timesheets/actions";
import type { TimesheetRow } from "@/lib/timesheets/queries";
import { TimesheetCard } from "./timesheet-card";

function Pending({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

/** Anything a manager should look at before approving in bulk. */
function needsAttention(sheet: TimesheetRow): boolean {
  return (
    sheet.isNoShow ||
    (sheet.varianceHours != null && Math.abs(sheet.varianceHours) >= 0.5) ||
    sheet.status === "staff_review_requested"
  );
}

/**
 * Manager review of a pay period.
 *
 * Approving in bulk is the point — a fortnight for seven staff is ninety-odd
 * rows, and approving them one at a time is why people go back to
 * spreadsheets. But anything with a real variance or a no-show starts
 * UNTICKED, so a bulk approval never sweeps up the days that need a look.
 */
export function TimesheetReview({
  sheets,
  properties,
}: {
  sheets: TimesheetRow[];
  properties: { id: string; name: string }[];
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(sheets.filter((s) => !needsAttention(s)).map((s) => s.id)),
  );
  const [genState, genAction] = useActionState<TimesheetActionState, FormData>(
    generateTimesheets,
    {},
  );
  const [appState, appAction] = useActionState<TimesheetActionState, FormData>(
    approveTimesheets,
    {},
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Read the clock once, in a lazy initialiser. Calling new Date() during
  // render is impure — it returns something different every render and
  // makes the server and client disagree at hydration.
  const [{ today, fortnightAgo }] = useState(() => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 13 * 86_400_000);
    return {
      today: now.toISOString().slice(0, 10),
      fortnightAgo: earlier.toISOString().slice(0, 10),
    };
  });

  const flagged = sheets.filter(needsAttention).length;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Prepare a pay period
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Builds timesheets from recorded attendance. Days that already have a
          timesheet are left exactly as they are.
        </p>

        {genState.error && (
          <div className="mt-3">
            <Alert tone="error">{genState.error}</Alert>
          </div>
        )}
        {genState.success && (
          <div className="mt-3">
            <Alert tone="success">{genState.success}</Alert>
          </div>
        )}

        <form action={genAction} className="mt-4 grid gap-3 sm:grid-cols-4">
          <Field label="Property" htmlFor="gen-property">
            <select
              id="gen-property"
              name="propertyId"
              required
              defaultValue={properties[0]?.id}
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From" htmlFor="gen-from">
            <Input
              id="gen-from"
              name="fromDate"
              type="date"
              required
              defaultValue={fortnightAgo}
            />
          </Field>
          <Field label="To" htmlFor="gen-to">
            <Input
              id="gen-to"
              name="toDate"
              type="date"
              required
              defaultValue={today}
            />
          </Field>
          <div className="flex items-end">
            <Pending label="Build" />
          </div>
        </form>
      </section>

      {sheets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Nothing waiting for approval
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Build a pay period above to bring recorded attendance in.
          </p>
        </div>
      ) : (
        <form action={appAction} className="space-y-4">
          {appState.error && <Alert tone="error">{appState.error}</Alert>}
          {appState.success && <Alert tone="success">{appState.success}</Alert>}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {selected.size} of {sheets.length} selected
              </p>
              {flagged > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {flagged} left unticked because they need a look.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(new Set(sheets.map((s) => s.id)))}
              >
                Select all
              </Button>
              <Pending label={`Approve ${selected.size}`} />
            </div>
          </div>

          {[...selected].map((id) => (
            <input key={id} type="hidden" name="ids" value={id} />
          ))}

          <div className="space-y-3">
            {sheets.map((sheet) => (
              <div key={sheet.id} className="flex gap-3">
                <label className="flex items-start pt-4">
                  <input
                    type="checkbox"
                    checked={selected.has(sheet.id)}
                    onChange={() => toggle(sheet.id)}
                    aria-label={`Approve ${sheet.staffName} on ${sheet.workDate}`}
                    className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                  />
                </label>
                <div className="min-w-0 flex-1">
                  <TimesheetCard sheet={sheet} showStaffName />
                </div>
              </div>
            ))}
          </div>
        </form>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Hours are estimates from recorded attendance for payroll to check, not
        an award interpretation. You cannot approve your own timesheet.
      </p>
    </div>
  );
}
