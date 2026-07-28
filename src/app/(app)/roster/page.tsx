import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getMyShifts, groupShifts, type StaffShift } from "@/lib/roster/queries";
import { formatHours } from "@/lib/format";
import { totalPaidHours } from "@/lib/roster/hours";
import { ShiftCard } from "@/components/roster/shift-card";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "My roster · StayFlow Staff",
};

// A roster changes the moment a manager publishes, so never cache it.
export const dynamic = "force-dynamic";

/** A titled group of shifts, rendered only when it has any. */
function ShiftGroup({ title, shifts }: { title: string; shifts: StaffShift[] }) {
  if (shifts.length === 0) return null;

  const headingId = `group-${title.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <section aria-labelledby={headingId}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2
          id={headingId}
          className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
        >
          {title}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {formatHours(totalPaidHours(shifts))}
        </p>
      </div>
      <div className="space-y-3">
        {shifts.map((shift) => (
          <ShiftCard key={shift.id} shift={shift} />
        ))}
      </div>
    </section>
  );
}

/**
 * Staff roster.
 *
 * Shows only published shifts belonging to the signed-in user. That
 * restriction is enforced by Row Level Security, not by a filter written
 * here — this query asks for "shifts" and the database decides which.
 */
export default async function RosterPage() {
  await requireUser();

  // Start from midnight so a shift already under way still appears, rather
  // than vanishing from the screen the moment it begins.
  const from = new Date();
  from.setHours(0, 0, 0, 0);

  const shifts = await getMyShifts(from.toISOString());
  const { today, thisWeek, upcoming } = groupShifts(shifts);
  const awaiting = shifts.filter((s) => s.acknowledgement?.decisionRequired);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          My roster
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {formatHours(totalPaidHours(shifts))} rostered
        </p>
      </div>

      {awaiting.length > 0 && (
        <Alert tone="warning" title="Response needed">
          {awaiting.length === 1
            ? "One shift is waiting for you to accept or decline."
            : `${awaiting.length} shifts are waiting for you to accept or decline.`}
        </Alert>
      )}

      {shifts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
          <CalendarDays
            className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
            strokeWidth={1.5}
          />
          <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
            No shifts rostered
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            When your manager publishes the roster, your shifts appear here and
            you will get a notification.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <ShiftGroup title="Today" shifts={today} />
          <ShiftGroup title="Rest of this week" shifts={thisWeek} />
          <ShiftGroup title="Upcoming" shifts={upcoming} />
        </div>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Hours shown are estimates based on your rostered times and unpaid
        breaks. Your pay is calculated from your approved timesheet.
      </p>
    </div>
  );
}
