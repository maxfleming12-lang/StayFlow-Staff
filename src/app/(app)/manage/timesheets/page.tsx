import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  TIMESHEET_VIEWS,
  TIMESHEET_VIEW_LIMIT,
  getOpenAdjustmentRequests,
  getTimesheetsForReview,
  isTimesheetView,
  type TimesheetView,
} from "@/lib/timesheets/queries";
import { getTeam } from "@/lib/team/queries";
import { TimesheetReview } from "@/components/timesheets/timesheet-review";
import { ManualTimesheet } from "@/components/timesheets/manual-timesheet";
import { TimesheetExport } from "@/components/timesheets/timesheet-export";
import { TimesheetPrintTable } from "@/components/timesheets/timesheet-print-table";
import { Alert } from "@/components/ui/alert";
import { DEFAULT_TIMEZONE, addIsoDays } from "@/lib/format";
import { atLeast } from "@/lib/auth/roles";
import { CorrectionRequests } from "@/components/timesheets/correction-requests";

export const metadata: Metadata = { title: "Timesheets · StayFlow Staff" };
export const dynamic = "force-dynamic";

const VIEW_SUMMARY: Record<TimesheetView, string> = {
  open: "Recorded hours waiting for a decision.",
  approved: "Approved and ready to send to payroll.",
  sent: "Already sent to payroll. These hours cannot be corrected while they are here.",
};

/**
 * Management timesheet review.
 *
 * RLS scopes the list to staff at the caller's properties, and
 * `guard_timesheet_management` independently blocks approving your own.
 */
export default async function ManageTimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requireRole("manager");
  const { view: rawView } = await searchParams;
  const view: TimesheetView = isTimesheetView(rawView) ? rawView : "open";

  const supabase = await createClient();
  const [sheets, propertyRes, team, corrections] = await Promise.all([
    getTimesheetsForReview(view),
    supabase
      .from("properties")
      .select("id, name")
      .eq("is_active", true)
      .is("archived_at", null)
      .order("name"),
    getTeam(),
    getOpenAdjustmentRequests(),
  ]);

  if (propertyRes.error) {
    throw new Error(`Could not load properties: ${propertyRes.error.message}`);
  }

  const properties = (propertyRes.data ?? []).map((p) => ({
    id: String(p.id),
    name: String(p.name),
  }));

  // Resolved here rather than in the browser: the client's clock may be in
  // another timezone, and reading it during render breaks hydration.
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: DEFAULT_TIMEZONE,
  }).format(new Date());

  // A fortnight back is the usual pay period at both motels.
  const fortnightAgo = addIsoDays(today, -13);

  // The query stops at a ceiling. Say so rather than letting a partial list
  // read as the whole period.
  const truncated = sheets.length >= TIMESHEET_VIEW_LIMIT;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div data-print-hide>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Timesheets
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          {VIEW_SUMMARY[view]}
        </p>
      </div>

      <nav
        aria-label="Timesheet view"
        className="flex flex-wrap gap-2"
        data-print-hide
      >
        {(Object.keys(TIMESHEET_VIEWS) as TimesheetView[]).map((key) => (
          <Link
            key={key}
            href={key === "open" ? "/manage/timesheets" : `/manage/timesheets?view=${key}`}
            aria-current={key === view ? "page" : undefined}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              key === view
                ? "border-teal-600 bg-teal-50 font-medium text-teal-800 dark:bg-teal-950 dark:text-teal-300"
                : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400"
            }`}
          >
            {TIMESHEET_VIEWS[key].label}
          </Link>
        ))}
      </nav>

      {truncated && (
        <div data-print-hide>
          <Alert tone="warning">
            Showing the first {TIMESHEET_VIEW_LIMIT} timesheets. Narrow the
            period and use Download to get the full set.
          </Alert>
        </div>
      )}

      <div data-print-hide className="space-y-5">
        <CorrectionRequests requests={corrections} />
      </div>

      <TimesheetExport
        properties={properties}
        defaultFrom={fortnightAgo}
        defaultTo={today}
        canReopen={atLeast(user.role, "administrator")}
      />

      <TimesheetPrintTable
        sheets={sheets}
        heading={`${TIMESHEET_VIEWS[view].label} — printed ${today}`}
      />

      <div data-print-hide className="space-y-5">
        <ManualTimesheet
          properties={properties}
          staff={team
            .filter((member) => member.isActive)
            .map((member) => ({ id: member.id, displayName: member.displayName }))}
          today={today}
        />
      </div>

      <div data-print-hide className="space-y-5">
        <TimesheetReview
          sheets={sheets}
          properties={properties}
          // Nothing here can be approved: it has already gone to payroll.
          readOnly={view === "sent"}
        />
      </div>
    </div>
  );
}
