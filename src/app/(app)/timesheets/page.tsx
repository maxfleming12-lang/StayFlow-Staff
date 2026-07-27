import type { Metadata } from "next";
import { Timer } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getMyTimesheets } from "@/lib/timesheets/queries";
import { formatHours } from "@/lib/format";
import { TimesheetCard } from "@/components/timesheets/timesheet-card";
import { TimesheetStaffActions } from "@/components/timesheets/timesheet-actions";

export const metadata: Metadata = { title: "My hours · StayFlow Staff" };
export const dynamic = "force-dynamic";

/** Statuses where a staff member can still say something. */
const OPEN = new Set(["draft", "submitted", "manager_review"]);

export default async function TimesheetsPage() {
  await requireUser();
  const sheets = await getMyTimesheets();

  const needsCheck = sheets.filter(
    (s) => OPEN.has(s.status) && !s.staffAcknowledgedAt,
  );
  const total = sheets
    .filter((s) => s.status === "approved" || s.status === "exported")
    .reduce((sum, s) => sum + (s.paidHours ?? 0), 0);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          My hours
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {formatHours(total)} approved
        </p>
      </div>

      {sheets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
          <Timer
            className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
            strokeWidth={1.5}
          />
          <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
            No hours recorded yet
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Once you have clocked on and your manager has prepared the pay
            period, your hours appear here to check.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {needsCheck.length > 0 && (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              {needsCheck.length === 1
                ? "One day is waiting for you to check."
                : `${needsCheck.length} days are waiting for you to check.`}{" "}
              Checking them helps your manager approve payroll on time.
            </p>
          )}

          {sheets.map((sheet) => (
            <TimesheetCard
              key={sheet.id}
              sheet={sheet}
              actions={
                OPEN.has(sheet.status) ? (
                  <TimesheetStaffActions
                    timesheetId={sheet.id}
                    acknowledged={Boolean(sheet.staffAcknowledgedAt)}
                  />
                ) : undefined
              }
            />
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Hours are worked out from your clock entries and are an estimate for
        payroll to check. They are not an award interpretation, and your pay
        is confirmed by your employer.
      </p>
    </div>
  );
}
