import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE, addIsoDays } from "@/lib/format";
import { buildLabourReport } from "@/lib/reports/labour";
import {
  REPORT_ROW_LIMIT,
  getLabourReportData,
  mayBeTruncated,
} from "@/lib/reports/queries";
import { Alert } from "@/components/ui/alert";
import { LabourReportTable } from "@/components/reports/labour-report";
import { ReportControls } from "@/components/reports/report-controls";

export const metadata: Metadata = { title: "Reports · StayFlow Staff" };
export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Labour reporting: rostered against worked.
 *
 * Restricted to manager and above. The check runs server-side, so removing
 * the navigation entry is not what protects it — and RLS independently
 * scopes every figure to the properties the caller manages.
 *
 * The period lives in the URL rather than in client state, so a report can
 * be bookmarked, reloaded, or sent to the owner and show the same figures.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; property?: string }>;
}) {
  await requireRole("manager");
  const { from: rawFrom, to: rawTo, property: rawProperty } = await searchParams;

  // Today at the property, not on the server or in the browser.
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: DEFAULT_TIMEZONE,
  }).format(new Date());

  // A fortnight is the usual pay period at both motels.
  const from = ISO_DATE.test(rawFrom ?? "") ? rawFrom! : addIsoDays(today, -13);
  const to = ISO_DATE.test(rawTo ?? "") ? rawTo! : today;
  const propertyId = UUID.test(rawProperty ?? "") ? rawProperty! : "";

  const supabase = await createClient();
  const propertyRes = await supabase
    .from("properties")
    .select("id, name")
    .eq("is_active", true)
    .is("archived_at", null)
    .order("name");

  if (propertyRes.error) {
    throw new Error(`Could not load properties: ${propertyRes.error.message}`);
  }
  const properties = (propertyRes.data ?? []).map((p) => ({
    id: String(p.id),
    name: String(p.name),
  }));

  const backwards = to < from;
  const data = backwards
    ? { shifts: [], timesheets: [], names: new Map<string, string>() }
    : await getLabourReportData(from, to, propertyId || undefined);
  const report = buildLabourReport(data.shifts, data.timesheets);

  const periodLabel = `${from} to ${to}`;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div data-print-hide>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Reports
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Rostered against worked hours across your properties.
        </p>
      </div>

      <ReportControls
        properties={properties}
        from={from}
        to={to}
        propertyId={propertyId}
      />

      {/* Shown only when printed, so the paper copy says what it covers. */}
      <div className="timesheet-print-only hidden">
        <h2 className="text-base font-semibold">Labour report — {periodLabel}</h2>
        <p className="text-xs">
          {propertyId
            ? (properties.find((p) => p.id === propertyId)?.name ?? "One property")
            : "All properties"}
        </p>
      </div>

      {backwards && (
        <div data-print-hide>
          <Alert tone="error">
            The end date is before the start date, so there is nothing to show.
          </Alert>
        </div>
      )}

      {!backwards && mayBeTruncated(data) && (
        <div data-print-hide>
          <Alert tone="warning">
            This period has more than {REPORT_ROW_LIMIT} rows, so the figures
            below are incomplete. Choose a shorter period.
          </Alert>
        </div>
      )}

      {!backwards && (
        <LabourReportTable
          report={report}
          names={data.names}
          periodLabel={periodLabel}
        />
      )}
    </div>
  );
}
