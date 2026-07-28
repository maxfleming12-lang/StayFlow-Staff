import { CalendarOff } from "lucide-react";
import type { LeaveRequest } from "@/lib/leave/queries";
import { leaveCategoryLabel } from "@/lib/leave/hours";
import { formatHours, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  approved:
    "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  declined: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300",
  pending: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  cancelled: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const STATUS_LABELS: Record<string, string> = {
  approved: "Approved",
  declined: "Declined",
  pending: "Awaiting review",
  cancelled: "Withdrawn",
};

/** Date range, collapsed when it is a single day. */
export function leaveDateLabel(request: LeaveRequest): string {
  if (request.firstDate === request.lastDate) {
    const day = formatShortDate(request.firstDate);
    return request.isPartialDay && request.startTime && request.endTime
      ? `${day}, ${request.startTime.slice(0, 5)}–${request.endTime.slice(0, 5)}`
      : day;
  }
  return `${formatShortDate(request.firstDate)} – ${formatShortDate(request.lastDate)}`;
}

/**
 * One leave request.
 *
 * `actions` lets the management screen slot in approve/decline controls
 * without this component knowing anything about who is looking at it.
 */
export function LeaveCard({
  request,
  showStaffName = false,
  actions,
}: {
  request: LeaveRequest;
  showStaffName?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {showStaffName && (
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              {request.staffName}
            </p>
          )}
          <p className="text-base font-medium text-slate-900 dark:text-slate-100">
            {leaveDateLabel(request)}
          </p>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {leaveCategoryLabel(request.category)}
            {request.totalHours != null && (
              <> · {formatHours(request.totalHours)}</>
            )}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
            STATUS_STYLES[request.status] ?? STATUS_STYLES.pending,
          )}
        >
          {STATUS_LABELS[request.status] ?? request.status}
        </span>
      </div>

      {request.note && (
        <p className="mt-3 whitespace-pre-line text-sm text-slate-600 dark:text-slate-400">
          {request.note}
        </p>
      )}

      {request.managerNote && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Manager note
          </p>
          <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">
            {request.managerNote}
          </p>
        </div>
      )}

      {request.conflictingShifts.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <p className="flex items-center gap-2 text-xs font-medium text-amber-900 dark:text-amber-200">
            <CalendarOff className="h-3.5 w-3.5" aria-hidden="true" />
            Already rostered on {request.conflictingShifts.length} shift
            {request.conflictingShifts.length === 1 ? "" : "s"} during this leave
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
            {request.conflictingShifts.map((shift) => (
              <li key={shift.id}>
                {formatShortDate(shift.startsAt)} · {shift.propertyName}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
            Approving does not remove these shifts. Arrange cover separately.
          </p>
        </div>
      )}

      {actions && <div className="mt-4">{actions}</div>}
    </article>
  );
}
