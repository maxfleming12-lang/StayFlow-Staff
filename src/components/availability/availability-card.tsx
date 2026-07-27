import type { AvailabilityRecord } from "@/lib/availability/queries";
import { describeRule } from "@/lib/availability/rules";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  approved:
    "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  declined: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300",
  pending: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
};

const STATUS_LABELS: Record<string, string> = {
  approved: "Approved",
  declined: "Not approved",
  pending: "Awaiting review",
};

/**
 * One availability rule.
 *
 * Unavailable rules carry a coloured edge so a manager scanning a list can
 * see at a glance which ones actually constrain the roster — an "available"
 * submission is useful information, but it does not stop anything.
 */
export function AvailabilityCard({
  record,
  showStaffName = false,
  actions,
}: {
  record: AvailabilityRecord;
  showStaffName?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <article
      className={cn(
        "rounded-xl border bg-white p-4 dark:bg-slate-900",
        record.isAvailable
          ? "border-slate-200 dark:border-slate-800"
          : "border-l-4 border-slate-200 border-l-amber-500 dark:border-slate-800 dark:border-l-amber-500",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {showStaffName && (
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              {record.staffName}
            </p>
          )}
          <p className="text-base font-medium text-slate-900 dark:text-slate-100">
            {describeRule(record)}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
            STATUS_STYLES[record.status] ?? STATUS_STYLES.pending,
          )}
        >
          {STATUS_LABELS[record.status] ?? record.status}
        </span>
      </div>

      {record.note && (
        <p className="mt-2 whitespace-pre-line text-sm text-slate-600 dark:text-slate-400">
          {record.note}
        </p>
      )}

      {record.reviewNote && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Manager note
          </p>
          <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">
            {record.reviewNote}
          </p>
        </div>
      )}

      {actions && <div className="mt-4">{actions}</div>}
    </article>
  );
}
