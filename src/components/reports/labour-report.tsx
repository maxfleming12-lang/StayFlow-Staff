import { AlertTriangle } from "lucide-react";
import { formatHours } from "@/lib/format";
import { needsAttention, type LabourReport } from "@/lib/reports/labour";
import { cn } from "@/lib/utils";

/** Signed hours, so a shortfall reads as one at a glance. */
function Variance({ hours }: { hours: number }) {
  if (Math.abs(hours) < 0.01) {
    return <span className="text-slate-500 dark:text-slate-400">—</span>;
  }
  const over = hours > 0;
  return (
    <span
      className={cn(
        "font-medium",
        Math.abs(hours) >= 2
          ? over
            ? "text-amber-700 dark:text-amber-400"
            : "text-red-700 dark:text-red-400"
          : "text-slate-600 dark:text-slate-400",
      )}
    >
      {over ? "+" : "−"}
      {formatHours(Math.abs(hours))}
    </span>
  );
}

/**
 * Rostered against worked, per person.
 *
 * Sorted worst-variance-first by the aggregation, so the rows a manager has
 * to act on are at the top rather than buried alphabetically.
 *
 * Every figure is an estimate for a human to check. That caveat matters more
 * here than on a single timesheet: a column of totals looks far more
 * authoritative than the rows it was summed from.
 */
export function LabourReportTable({
  report,
  names,
  periodLabel,
}: {
  report: LabourReport;
  names: Map<string, string>;
  periodLabel: string;
}) {
  const { people, totals } = report;

  if (people.length === 0 && totals.unfilledShifts === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
          Nothing in this period
        </p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          No published shifts and no recorded hours between those dates.
        </p>
      </div>
    );
  }

  return (
    <div className="labour-report-root space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Rostered", value: formatHours(totals.rosteredHours) },
          { label: "Worked", value: formatHours(totals.workedHours) },
          {
            label: "Variance",
            value: <Variance hours={totals.varianceHours} />,
          },
          { label: "Shifts", value: String(totals.shiftCount) },
        ].map((tile) => (
          <div
            key={tile.label}
            className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
          >
            <dt className="text-xs text-slate-500 dark:text-slate-400">
              {tile.label}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold text-slate-900 dark:text-slate-50">
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>

      {(totals.noShows > 0 ||
        totals.missingClockOuts > 0 ||
        totals.unfilledShifts > 0) && (
        <div className="flex flex-wrap gap-2 text-sm">
          {totals.unfilledShifts > 0 && (
            <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {totals.unfilledShifts} unfilled shift
              {totals.unfilledShifts === 1 ? "" : "s"}
            </span>
          )}
          {totals.noShows > 0 && (
            <span className="rounded-lg bg-red-50 px-3 py-1.5 text-red-900 dark:bg-red-950 dark:text-red-200">
              {totals.noShows} no-show{totals.noShows === 1 ? "" : "s"}
            </span>
          )}
          {totals.missingClockOuts > 0 && (
            <span className="rounded-lg bg-red-50 px-3 py-1.5 text-red-900 dark:bg-red-950 dark:text-red-200">
              {totals.missingClockOuts} missing clock-out
              {totals.missingClockOuts === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">
            Rostered against worked hours for {periodLabel}
          </caption>
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800">
              {["Staff", "Rostered", "Worked", "Variance", "Shifts", "Flags"].map(
                (heading, i) => (
                  <th
                    key={heading}
                    scope="col"
                    className={cn(
                      "p-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400",
                      i === 0 ? "text-left" : "text-right",
                      heading === "Flags" && "text-left",
                    )}
                  >
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {people.map((row) => (
              <tr
                key={row.userId}
                className="border-b border-slate-100 last:border-0 dark:border-slate-800"
              >
                <th
                  scope="row"
                  className="p-3 text-left font-medium text-slate-900 dark:text-slate-100"
                >
                  {names.get(row.userId) ?? "Unknown"}
                </th>
                <td className="p-3 text-right text-slate-600 dark:text-slate-400">
                  {formatHours(row.rosteredHours)}
                </td>
                <td className="p-3 text-right text-slate-900 dark:text-slate-100">
                  {formatHours(row.workedHours)}
                </td>
                <td className="p-3 text-right">
                  <Variance hours={row.varianceHours} />
                </td>
                <td className="p-3 text-right text-slate-600 dark:text-slate-400">
                  {row.shiftCount}
                </td>
                <td className="p-3 text-left">
                  {needsAttention(row) ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      {[
                        row.noShows > 0 && `${row.noShows} no-show`,
                        row.missingClockOuts > 0 &&
                          `${row.missingClockOuts} not clocked out`,
                        Math.abs(row.varianceHours) >= 2 && "off plan",
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  ) : (
                    <span className="sr-only">Nothing to flag</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 font-semibold dark:border-slate-700">
              <th scope="row" className="p-3 text-left text-slate-900 dark:text-slate-100">
                Total
              </th>
              <td className="p-3 text-right text-slate-900 dark:text-slate-100">
                {formatHours(totals.rosteredHours)}
              </td>
              <td className="p-3 text-right text-slate-900 dark:text-slate-100">
                {formatHours(totals.workedHours)}
              </td>
              <td className="p-3 text-right">
                <Variance hours={totals.varianceHours} />
              </td>
              <td className="p-3 text-right text-slate-900 dark:text-slate-100">
                {totals.shiftCount}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Rostered hours come from the published roster after planned unpaid
        breaks. Worked hours come from approved and recorded timesheets. Both
        are estimates for you to check, not an award interpretation — overtime,
        penalty rates, loadings and allowances are not calculated here.
      </p>
    </div>
  );
}
