"use client";

import { useState } from "react";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

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
}: {
  properties: { id: string; name: string }[];
  defaultFrom: string;
  defaultTo: string;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [propertyId, setPropertyId] = useState("");

  const invalid = !from || !to || to < from;

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
    </section>
  );
}
