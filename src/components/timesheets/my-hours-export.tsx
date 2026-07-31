"use client";

import { useState } from "react";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/**
 * Take a copy of your own hours.
 *
 * Staff ask for this constantly and for reasons that matter — a tenancy
 * application, Centrelink, a tax return, or simply disagreeing with a pay
 * slip. Until now the only record they could keep was a screenshot.
 *
 * It calls the same endpoint the manager screen uses. Row Level Security is
 * what limits the result to this person's own rows, so there is no separate
 * staff export to keep in step.
 */
export function MyHoursExport({
  defaultFrom,
  defaultTo,
}: {
  defaultFrom: string;
  defaultTo: string;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const invalid = !from || !to || to < from;
  const href = `/api/timesheets/export?${new URLSearchParams({ from, to }).toString()}`;

  return (
    <section
      aria-labelledby="my-hours-export-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      data-print-hide
    >
      <h2
        id="my-hours-export-heading"
        className="text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        Keep a copy of your hours
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Downloads a spreadsheet of your own recorded hours for the dates you
        choose. Nothing is changed by taking a copy.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="From" htmlFor="my-from">
          <Input
            id="my-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </Field>
        <Field label="To" htmlFor="my-to">
          <Input
            id="my-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </Field>
        <div className="flex items-end gap-2">
          {invalid ? (
            <Button size="sm" disabled>
              <Download className="h-4 w-4" aria-hidden="true" />
              Download
            </Button>
          ) : (
            <a
              href={href}
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

      {invalid && from && to && (
        <p className="mt-2 text-sm text-red-700 dark:text-red-400">
          The end date is before the start date.
        </p>
      )}
    </section>
  );
}
