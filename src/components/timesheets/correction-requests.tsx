"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { MessageSquareWarning } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  resolveAdjustmentRequest,
  type TimesheetActionState,
} from "@/lib/timesheets/actions";
import type { AdjustmentRequest } from "@/lib/timesheets/queries";
import { formatShortDate, formatTime } from "@/lib/format";

function DecisionButton({
  decision,
  label,
}: {
  decision: "approved" | "declined";
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="decision"
      value={decision}
      size="sm"
      variant={decision === "approved" ? "primary" : "outline"}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Working…" : label}
    </Button>
  );
}

/** "9:00am–5:00pm, 30 min break" or a dash when nothing was given. */
function describe(
  start: string | null,
  end: string | null,
  breakMinutes: number | null,
): string {
  if (!start || !end) return "—";
  const base = `${formatTime(start)}–${formatTime(end)}`;
  return breakMinutes == null ? base : `${base}, ${breakMinutes} min break`;
}

function RequestCard({ request }: { request: AdjustmentRequest }) {
  const [state, action] = useActionState<TimesheetActionState, FormData>(
    resolveAdjustmentRequest,
    {},
  );

  if (state.success) {
    return <Alert tone="success">{state.success}</Alert>;
  }

  const locked = Boolean(
    request.current?.lockedAt || request.current?.exportedAt,
  );
  const applicable =
    Boolean(request.timesheetId) &&
    Boolean(request.requestedStart) &&
    Boolean(request.requestedEnd) &&
    !locked;

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {request.staffName}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {request.requestedDate
            ? formatShortDate(`${request.requestedDate}T00:00:00Z`)
            : "No date given"}
        </p>
      </div>

      <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Recorded</dt>
          <dd className="text-slate-900 dark:text-slate-100">
            {request.current
              ? describe(
                  request.current.actualStart,
                  request.current.actualEnd,
                  request.current.breakMinutes,
                )
              : "No timesheet attached"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">They say</dt>
          <dd className="font-medium text-slate-900 dark:text-slate-100">
            {describe(
              request.requestedStart,
              request.requestedEnd,
              request.requestedBreakMinutes,
            )}
          </dd>
        </div>
      </dl>

      <p className="mt-2 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">
        {request.explanation}
      </p>

      {state.error && (
        <div className="mt-2">
          <Alert tone="error">{state.error}</Alert>
        </div>
      )}

      {locked && (
        <div className="mt-2">
          <Alert tone="warning">
            That timesheet has gone to payroll. An administrator must reopen it
            before this can be applied.
          </Alert>
        </div>
      )}

      <form action={action} className="mt-3 space-y-2">
        <input type="hidden" name="requestId" value={request.id} />
        <Field label="Reply to them" htmlFor={`ar-note-${request.id}`}>
          <Input
            id={`ar-note-${request.id}`}
            name="managerNote"
            maxLength={500}
            placeholder="Checked with reception — updated."
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {applicable && (
            <DecisionButton decision="approved" label="Apply these hours" />
          )}
          <DecisionButton decision="declined" label="Decline" />
        </div>
        {!applicable && !locked && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No start and finish were given, so there is nothing to apply
            automatically. Edit the hours on the timesheet, then decline this
            with a note.
          </p>
        )}
      </form>
    </li>
  );
}

/**
 * Staff correction requests waiting on a manager.
 *
 * These were written to the database from the day timesheets shipped and
 * read by nothing, so reporting wrong hours went into a void. Placed above
 * the approval list because approving a pay period while somebody is
 * disputing a day in it is the wrong order to work.
 */
export function CorrectionRequests({
  requests,
}: {
  requests: AdjustmentRequest[];
}) {
  if (requests.length === 0) return null;

  return (
    <section
      aria-labelledby="corrections-heading"
      className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950"
    >
      <h2
        id="corrections-heading"
        className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200"
      >
        <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />
        Correction requests ({requests.length})
      </h2>
      <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">
        Staff have reported these hours as wrong. Deal with them before
        approving the pay period.
      </p>
      <ul className="mt-3 space-y-2">
        {requests.map((request) => (
          <RequestCard key={request.id} request={request} />
        ))}
      </ul>
    </section>
  );
}
