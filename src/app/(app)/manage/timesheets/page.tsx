import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  getOpenAdjustmentRequests,
  getTimesheetsForReview,
} from "@/lib/timesheets/queries";
import { getTeam } from "@/lib/team/queries";
import { TimesheetReview } from "@/components/timesheets/timesheet-review";
import { ManualTimesheet } from "@/components/timesheets/manual-timesheet";
import { TimesheetExport } from "@/components/timesheets/timesheet-export";
import { TimesheetPrintTable } from "@/components/timesheets/timesheet-print-table";
import { DEFAULT_TIMEZONE, addIsoDays } from "@/lib/format";
import { CorrectionRequests } from "@/components/timesheets/correction-requests";

export const metadata: Metadata = { title: "Timesheets · StayFlow Staff" };
export const dynamic = "force-dynamic";

/**
 * Management timesheet review.
 *
 * RLS scopes the list to staff at the caller's properties, and
 * `guard_timesheet_management` independently blocks approving your own.
 */
export default async function ManageTimesheetsPage() {
  await requireRole("manager");

  const supabase = await createClient();
  const [sheets, propertyRes, team, corrections] = await Promise.all([
    getTimesheetsForReview(),
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

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div data-print-hide>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Timesheets
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Recorded hours waiting for approval.
        </p>
      </div>

      <div data-print-hide className="space-y-5">
        <CorrectionRequests requests={corrections} />
      </div>

      <TimesheetExport
        properties={properties}
        defaultFrom={fortnightAgo}
        defaultTo={today}
      />

      <TimesheetPrintTable
        sheets={sheets}
        heading={`Timesheets awaiting approval — printed ${today}`}
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
        <TimesheetReview sheets={sheets} properties={properties} />
      </div>
    </div>
  );
}
