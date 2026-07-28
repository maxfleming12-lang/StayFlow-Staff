import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getTimesheetsForReview } from "@/lib/timesheets/queries";
import { getTeam } from "@/lib/team/queries";
import { DEFAULT_TIMEZONE } from "@/lib/format";
import { TimesheetReview } from "@/components/timesheets/timesheet-review";
import { ManualTimesheet } from "@/components/timesheets/manual-timesheet";

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
  const [sheets, propertyRes, team] = await Promise.all([
    getTimesheetsForReview(),
    supabase
      .from("properties")
      .select("id, name")
      .eq("is_active", true)
      .is("archived_at", null)
      .order("name"),
    getTeam(),
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

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Timesheets
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Recorded hours waiting for approval.
        </p>
      </div>

      <ManualTimesheet
        properties={properties}
        staff={team
          .filter((member) => member.isActive)
          .map((member) => ({ id: member.id, displayName: member.displayName }))}
        today={today}
      />

      <TimesheetReview sheets={sheets} properties={properties} />
    </div>
  );
}
