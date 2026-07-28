import { formatDayHeading, isToday } from "@/lib/roster/week";
import { formatHours, formatTime } from "@/lib/format";
import type { RosterProperty, RosterShift, RosterStaff } from "@/lib/roster/manager-queries";
import { cn } from "@/lib/utils";
import { AssignOpenShift } from "./assign-open-shift";

/** ISO date key of a shift in the property timezone. */
function dayKeyOf(startsAt: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Australia/Sydney",
  }).format(new Date(startsAt));
}

/** One shift block inside a day cell. */
function ShiftBlock({ shift }: { shift: RosterShift }) {
  const draft = shift.status === "draft";

  return (
    <div
      className={cn(
        "rounded-md border-l-4 bg-slate-50 px-2 py-1.5 text-xs dark:bg-slate-800",
        draft && "border-dashed bg-white dark:bg-slate-900",
      )}
      style={{ borderLeftColor: shift.propertyColour ?? "#0f766e" }}
    >
      <p className="font-medium text-slate-900 dark:text-slate-100">
        {formatTime(shift.startsAt)}–{formatTime(shift.endsAt)}
      </p>
      <p className="text-slate-500 dark:text-slate-400">
        {formatHours(shift.paidHours)}
      </p>
      {draft && (
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
          Draft
        </p>
      )}
      {shift.ackStatus === "declined" && (
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-red-700 dark:text-red-400">
          Declined
        </p>
      )}
      {shift.ackStatus === "accepted" && (
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          Accepted
        </p>
      )}
    </div>
  );
}

/**
 * Weekly roster grid: one row per staff member, one column per day.
 *
 * Scrolls horizontally inside its own container on a phone rather than
 * forcing the whole page sideways, and the staff-name column stays pinned so
 * a manager can always tell whose row they are reading.
 */
export function RosterGrid({
  days,
  staff,
  shifts,
  properties,
  weekStartDate,
}: {
  days: string[];
  staff: RosterStaff[];
  shifts: RosterShift[];
  properties: RosterProperty[];
  weekStartDate: string;
}) {
  // Index shifts by staff and day so each cell is a lookup, not a filter.
  const byStaffDay = new Map<string, RosterShift[]>();
  const openShifts: RosterShift[] = [];

  for (const shift of shifts) {
    if (!shift.userId) {
      openShifts.push(shift);
      continue;
    }
    const key = `${shift.userId}:${dayKeyOf(shift.startsAt)}`;
    const list = byStaffDay.get(key);
    if (list) list.push(shift);
    else byStaffDay.set(key, [shift]);
  }

  const rostered = staff.filter((s) =>
    shifts.some((shift) => shift.userId === s.id),
  );
  const unrostered = staff.filter(
    (s) => !shifts.some((shift) => shift.userId === s.id),
  );

  if (staff.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No active staff to roster yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Wide content scrolls inside its own container. */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <caption className="sr-only">
            Roster grid for the week beginning {weekStartDate}
          </caption>
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th
                scope="col"
                className="sticky left-0 z-10 bg-white p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400"
              >
                Staff
              </th>
              {days.map((day) => (
                <th
                  key={day}
                  scope="col"
                  className={cn(
                    "p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400",
                    isToday(day) && "text-teal-700 dark:text-teal-400",
                  )}
                >
                  {formatDayHeading(day)}
                  {isToday(day) && <span className="sr-only"> (today)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...rostered, ...unrostered].map((person) => {
              const weekHours = shifts
                .filter((s) => s.userId === person.id)
                .reduce((t, s) => t + s.paidHours, 0);

              return (
                <tr
                  key={person.id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 max-w-[11rem] bg-white p-3 text-left align-top dark:bg-slate-900"
                  >
                    <span className="block truncate font-medium text-slate-900 dark:text-slate-100">
                      {person.displayName}
                    </span>
                    <span className="block truncate text-xs font-normal text-slate-500 dark:text-slate-400">
                      {person.jobTitle ?? person.teamName ?? "—"}
                    </span>
                    {weekHours > 0 && (
                      <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">
                        {formatHours(weekHours)}
                      </span>
                    )}
                  </th>

                  {days.map((day) => {
                    const cell = byStaffDay.get(`${person.id}:${day}`) ?? [];
                    return (
                      <td key={day} className="p-2 align-top">
                        {cell.length === 0 ? (
                          <span className="sr-only">No shift</span>
                        ) : (
                          <div className="space-y-1.5">
                            {cell.map((shift) => (
                              <ShiftBlock key={shift.id} shift={shift} />
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openShifts.length > 0 && (
        <section
          aria-labelledby="open-shifts"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950"
        >
          <h2
            id="open-shifts"
            className="text-sm font-semibold text-amber-900 dark:text-amber-200"
          >
            Unfilled shifts ({openShifts.length})
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {openShifts.map((shift) => (
              <li key={shift.id}>
                <div className="rounded-lg bg-white p-2.5 text-xs dark:bg-slate-900">
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {formatDayHeading(dayKeyOf(shift.startsAt))} ·{" "}
                    {formatTime(shift.startsAt)}–{formatTime(shift.endsAt)}
                  </p>
                  <p className="text-slate-500 dark:text-slate-400">
                    {shift.propertyName}
                    {shift.requiredRole && ` · ${shift.requiredRole}`}
                  </p>
                  <AssignOpenShift shiftId={shift.id} staff={staff} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {properties.length > 1 && (
        <p className="text-xs text-slate-500 dark:text-slate-400" data-print-hide>
          The coloured edge on each shift shows its property.
        </p>
      )}
    </div>
  );
}
