"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Download, Printer, Send, Undo2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  markPeriodExported,
  reopenExportedPeriod,
  type TimesheetActionState,
} from "@/lib/timesheets/actions";

function PendingButton({
  label,
  busy,
  variant = "primary",
  icon,
}: {
  label: string;
  busy: string;
  variant?: "primary" | "outline" | "danger";
  icon?: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={variant}
      disabled={pending}
      aria-busy={pending}
    >
      {icon}
      {pending ? busy : label}
    </Button>
  );
}

/**
 * Download a pay period, or print it.
 *
 * Payroll is done in a spreadsheet at both motels, so the CSV is the real
 * deliverable; printing is for the paper copy that goes in the folder.
 *
 * The download is a plain link, not a fetch-and-blob. The browser handles
 * the save dialog, long exports stream rather than buffering in memory, and
 * it still works if JavaScript fails — which on a motel tablet on hotel
 * wifi is worth having.
 */
export function TimesheetExport({
  properties,
  defaultFrom,
  defaultTo,
  canReopen,
}: {
  properties: { id: string; name: string }[];
  defaultFrom: string;
  defaultTo: string;
  /** Administrators only: taking a period back from payroll. */
  canReopen: boolean;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [propertyId, setPropertyId] = useState("");
  const [reopening, setReopening] = useState(false);

  const [markState, markAction] = useActionState<TimesheetActionState, FormData>(
    markPeriodExported,
    {},
  );
  const [reopenState, reopenAction] = useActionState<
    TimesheetActionState,
    FormData
  >(reopenExportedPeriod, {});

  const invalid = !from || !to || to < from;

  /** The chosen period, carried into each action's form. */
  const periodFields = (
    <>
      <input type="hidden" name="fromDate" value={from} />
      <input type="hidden" name="toDate" value={to} />
      <input type="hidden" name="propertyId" value={propertyId} />
    </>
  );

  const params = new URLSearchParams({ from, to });
  if (propertyId) {
    params.set("property", propertyId);
    const name = properties.find((p) => p.id === propertyId)?.name;
    if (name) params.set("propertyName", name);
  }

  return (
    <section
      aria-labelledby="timesheet-export-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      data-print-hide
    >
      <h2
        id="timesheet-export-heading"
        className="text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        Download or print a pay period
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        The download opens in Excel or Google Sheets. Downloading does not
        change anything — you can take a copy as often as you like while you
        check the figures.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Field label="From" htmlFor="export-from">
          <Input
            id="export-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </Field>
        <Field label="To" htmlFor="export-to">
          <Input
            id="export-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </Field>
        <Field label="Property" htmlFor="export-property">
          <select
            id="export-property"
            value={propertyId}
            onChange={(event) => setPropertyId(event.target.value)}
            className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="">Both properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex items-end gap-2">
          {invalid ? (
            <Button size="sm" disabled>
              <Download className="h-4 w-4" aria-hidden="true" />
              Download
            </Button>
          ) : (
            <a
              href={`/api/timesheets/export?${params.toString()}`}
              // `download` is advisory; the response sets the real filename
              // through Content-Disposition.
              download
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-teal-700 px-3 text-sm font-medium text-white hover:bg-teal-800"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download
            </a>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.print()}
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print
          </Button>
        </div>
      </div>

      {to < from && from && to && (
        <p className="mt-2 text-sm text-red-700 dark:text-red-400">
          The end date is before the start date.
        </p>
      )}

      <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
        <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
          Send to payroll
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Marks the approved timesheets in this period as sent. Their hours can
          no longer be corrected afterwards
          {canReopen ? ", unless you reopen the period." : " without an administrator."}
        </p>

        <div className="mt-3 space-y-2">
          {markState.success && (
            <Alert tone="success">{markState.success}</Alert>
          )}
          {markState.error && (
            <Alert tone={markState.needsConfirmation ? "warning" : "error"}>
              {markState.error}
            </Alert>
          )}
          {reopenState.success && (
            <Alert tone="success">{reopenState.success}</Alert>
          )}
          {reopenState.error && <Alert tone="error">{reopenState.error}</Alert>}
        </div>

        <form action={markAction} className="mt-3 space-y-3">
          {periodFields}

          {markState.needsConfirmation && (
            <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                name="confirm"
                required
                className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 dark:border-slate-600"
              />
              <span>
                Yes, mark this period as sent to payroll.
              </span>
            </label>
          )}

          <PendingButton
            label={
              markState.needsConfirmation
                ? "Yes, mark as sent"
                : "Mark as sent to payroll"
            }
            busy="Marking…"
            icon={<Send className="h-4 w-4" aria-hidden="true" />}
          />
        </form>

        {canReopen && (
          <div className="mt-4 border-t border-dashed border-slate-200 pt-3 dark:border-slate-800">
            {!reopening ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setReopening(true)}
              >
                <Undo2 className="h-4 w-4" aria-hidden="true" />
                Reopen a period sent to payroll
              </Button>
            ) : (
              <form action={reopenAction} className="space-y-3">
                {periodFields}
                <Alert tone="warning">
                  This takes the timesheets in this period back from payroll so
                  their hours can be corrected. Anything already locked is left
                  as it is.
                </Alert>
                <div className="flex flex-wrap gap-2">
                  <PendingButton
                    label="Reopen this period"
                    busy="Reopening…"
                    variant="danger"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setReopening(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
