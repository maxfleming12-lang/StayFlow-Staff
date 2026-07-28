import { AlertTriangle } from "lucide-react";
import type { TimesheetRow } from "@/lib/timesheets/queries";
import { TIMESHEET_STATUS_LABEL } from "@/lib/timesheets/generate";
import { formatHours, formatShortDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  exported: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  locked: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  staff_review_requested: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
};

/**
 * One day's recorded hours.
 *
 * Rostered and actual are shown side by side because the question a manager
 * is actually asking is "does this match what I planned?", and the question
 * a staff member is asking is "is this what I worked?".
 */
export function TimesheetCard({
  sheet,
  showStaffName = false,
  actions,
}: {
  sheet: TimesheetRow;
  showStaffName?: boolean;
  actions?: React.ReactNode;
}) {
  const variance = sheet.varianceHours;
  const notable = variance != null && Math.abs(variance) >= 0.5;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {showStaffName && (
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              {sheet.staffName}
            </p>
          )}
          <p className="text-base font-medium text-slate-900 dark:text-slate-100">
            {formatShortDate(sheet.workDate)}
          </p>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {sheet.propertyName}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
            STATUS_STYLES[sheet.status] ??
              "bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-300",
          )}
        >
          {TIMESHEET_STATUS_LABEL[sheet.status] ?? sheet.status}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">Rostered</dt>
          <dd className="text-slate-700 dark:text-slate-300">
            {sheet.rosteredStart && sheet.rosteredEnd
              ? `${formatTime(sheet.rosteredStart)} – ${formatTime(sheet.rosteredEnd)}`
              : "Not rostered"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">Actual</dt>
          <dd className="text-slate-700 dark:text-slate-300">
            {sheet.actualStart
              ? `${formatTime(sheet.actualStart)} – ${
                  sheet.actualEnd ? formatTime(sheet.actualEnd) : "still on"
                }`
              : "No attendance"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">Paid hours</dt>
          <dd className="font-medium text-slate-900 dark:text-slate-100">
            {sheet.paidHours != null ? formatHours(sheet.paidHours) : "—"}
            {sheet.breakMinutes > 0 && (
              <span className="font-normal text-slate-500">
                {" "}
                · {sheet.breakMinutes} min break
              </span>
            )}
          </dd>
        </div>
        {variance != null && (
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">
              Against roster
            </dt>
            <dd
              className={cn(
                "font-medium",
                notable
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-slate-700 dark:text-slate-300",
              )}
            >
              {variance > 0 ? "+" : ""}
              {variance.toFixed(2)} h
            </dd>
          </div>
        )}
      </dl>

      {sheet.isNoShow && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Rostered but never clocked in.
        </p>
      )}

      {sheet.staffNote && (
        <p className="mt-3 whitespace-pre-line text-sm text-slate-600 dark:text-slate-400">
          {sheet.staffNote}
        </p>
      )}

      {sheet.managerNote && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Manager note
          </p>
          <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">
            {sheet.managerNote}
          </p>
        </div>
      )}

      {actions && <div className="mt-4">{actions}</div>}
    </article>
  );
}
