"use client";

import { Download, Printer } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/**
 * Period and property for the labour report.
 *
 * A plain GET form, so the report lives in the URL: a manager can bookmark a
 * period, reload it, or send the link to the owner and have them see the
 * same figures. Client state would lose all of that.
 */
export function ReportControls({
  properties,
  from,
  to,
  propertyId,
}: {
  properties: { id: string; name: string }[];
  from: string;
  to: string;
  propertyId: string;
}) {
  const params = new URLSearchParams({ from, to });
  if (propertyId) {
    params.set("property", propertyId);
    const name = properties.find((p) => p.id === propertyId)?.name;
    if (name) params.set("propertyName", name);
  }

  return (
    <section
      aria-labelledby="report-controls-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      data-print-hide
    >
      <h2
        id="report-controls-heading"
        className="text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        Choose a period
      </h2>

      <form method="get" className="mt-4 grid gap-3 sm:grid-cols-4">
        <Field label="From" htmlFor="report-from">
          <Input id="report-from" type="date" name="from" defaultValue={from} required />
        </Field>
        <Field label="To" htmlFor="report-to">
          <Input id="report-to" type="date" name="to" defaultValue={to} required />
        </Field>
        <Field label="Property" htmlFor="report-property">
          <select
            id="report-property"
            name="property"
            defaultValue={propertyId}
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
        <div className="flex items-end">
          <Button type="submit" size="sm">
            Show report
          </Button>
        </div>
      </form>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <Link
          href={`/api/reports/labour?${params.toString()}`}
          download
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-teal-700 px-3 text-sm font-medium text-white hover:bg-teal-800"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download CSV
        </Link>
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
    </section>
  );
}
