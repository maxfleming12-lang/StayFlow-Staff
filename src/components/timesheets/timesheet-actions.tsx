"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  acknowledgeTimesheet,
  requestCorrection,
  type TimesheetActionState,
} from "@/lib/timesheets/actions";

function Pending({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * Staff controls for one timesheet.
 *
 * "These look right" and "something is wrong" are the only two things a
 * staff member can do — they cannot edit the hours, because attendance is
 * append-only and a correction has to be a manager's decision.
 */
export function TimesheetStaffActions({
  timesheetId,
  acknowledged,
}: {
  timesheetId: string;
  acknowledged: boolean;
}) {
  const [mode, setMode] = useState<null | "correct">(null);
  const [ackState, ackAction] = useActionState<TimesheetActionState, FormData>(
    acknowledgeTimesheet,
    {},
  );
  const [corrState, corrAction] = useActionState<TimesheetActionState, FormData>(
    requestCorrection,
    {},
  );

  const settled = ackState.success ?? corrState.success;
  if (settled) return <Alert tone="success">{settled}</Alert>;

  if (acknowledged && mode === null) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          You have checked these hours.
        </p>
        <Button variant="ghost" size="sm" onClick={() => setMode("correct")}>
          Something is wrong
        </Button>
      </div>
    );
  }

  if (mode === "correct") {
    return (
      <form action={corrAction} className="space-y-3">
        <input type="hidden" name="timesheetId" value={timesheetId} />
        {corrState.error && <Alert tone="error">{corrState.error}</Alert>}

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Start should be" htmlFor={`cs-${timesheetId}`}>
            <Input id={`cs-${timesheetId}`} name="requestedStart" type="time" />
          </Field>
          <Field label="Finish should be" htmlFor={`ce-${timesheetId}`}>
            <Input id={`ce-${timesheetId}`} name="requestedEnd" type="time" />
          </Field>
          <Field label="Unpaid break (min)" htmlFor={`cb-${timesheetId}`}>
            <Input
              id={`cb-${timesheetId}`}
              name="requestedBreakMinutes"
              type="number"
              min={0}
              max={600}
            />
          </Field>
        </div>

        <Field
          label="What was wrong?"
          htmlFor={`cx-${timesheetId}`}
          hint="Your recorded times stay as they are until your manager reviews this."
        >
          <textarea
            id={`cx-${timesheetId}`}
            name="explanation"
            rows={2}
            required
            minLength={10}
            maxLength={1000}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </Field>

        <div className="flex gap-2">
          <Pending label="Send to my manager" />
          <Button variant="ghost" size="sm" onClick={() => setMode(null)}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      {ackState.error && <Alert tone="error">{ackState.error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <form action={ackAction}>
          <input type="hidden" name="id" value={timesheetId} />
          <Pending label="These look right" />
        </form>
        <Button variant="outline" size="sm" onClick={() => setMode("correct")}>
          Something is wrong
        </Button>
      </div>
    </div>
  );
}
