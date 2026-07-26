import { Clock, MapPin, StickyNote, Users } from "lucide-react";
import type { StaffShift } from "@/lib/roster/queries";
import { formatHours, formatLongDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ShiftResponse } from "./shift-response";

/** Badge describing the acknowledgement state of a shift. */
function AckBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    accepted:
      "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    declined: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300",
    pending: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
    viewed: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  };
  const labels: Record<string, string> = {
    accepted: "Accepted",
    declined: "Declined",
    pending: "Needs your response",
    viewed: "Needs your response",
  };

  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium",
        styles[status] ?? styles.pending,
      )}
    >
      {labels[status] ?? status}
    </span>
  );
}

/**
 * One shift on the staff roster.
 *
 * The property colour runs down the left edge so a staff member working
 * both motels can tell them apart at a glance without reading.
 */
export function ShiftCard({ shift }: { shift: StaffShift }) {
  const unpaidBreak = shift.breaks
    .filter((b) => !b.isPaid)
    .reduce((t, b) => t + b.durationMinutes, 0);

  return (
    <article className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 pl-5 dark:border-slate-800 dark:bg-slate-900">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ backgroundColor: shift.propertyColour ?? "#0f766e" }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            {formatLongDate(shift.startsAt)}
          </p>
          <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
            {formatTime(shift.startsAt)} – {formatTime(shift.endsAt)}
          </p>
        </div>
        {shift.acknowledgement && (
          <AckBadge status={shift.acknowledgement.status} />
        )}
      </div>

      <dl className="mt-3 space-y-1.5 text-sm text-slate-600 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
          <dt className="sr-only">Property</dt>
          <dd>{shift.propertyName}</dd>
        </div>

        {shift.teamName && (
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
            <dt className="sr-only">Team</dt>
            <dd>{shift.teamName}</dd>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <dt className="sr-only">Hours</dt>
          <dd>
            {formatHours(shift.paidHours)}
            {unpaidBreak > 0 && (
              <span className="text-slate-500">
                {" "}
                · {unpaidBreak} min unpaid break
              </span>
            )}
          </dd>
        </div>

        {shift.notes && (
          <div className="flex gap-2">
            <StickyNote className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <dt className="sr-only">Manager notes</dt>
              <dd className="whitespace-pre-line">{shift.notes}</dd>
            </div>
          </div>
        )}
      </dl>

      {shift.acknowledgement?.decisionRequired && (
        <ShiftResponse shiftId={shift.id} />
      )}
    </article>
  );
}
