import { requireRole } from "@/lib/auth/session";
import { getLabourReportData } from "@/lib/reports/queries";
import { buildLabourReport } from "@/lib/reports/labour";
import { labourCsvFilename, labourReportToCsv } from "@/lib/reports/csv";

/**
 * Download the labour report as CSV.
 *
 * Manager and above, unlike the timesheet export: that one serves a staff
 * member their own hours, whereas this is everybody's figures side by side
 * and has no per-person reading. RLS still decides which properties the
 * rows come from.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Same ceiling as the timesheet export, for the same reason. */
const MAX_RANGE_DAYS = 730;

export async function GET(request: Request): Promise<Response> {
  await requireRole("manager");

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const property = params.get("property") ?? "";
  const propertyName = params.get("propertyName") ?? "";

  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return new Response("Provide from and to dates as yyyy-mm-dd.", {
      status: 400,
    });
  }
  if (to < from) {
    return new Response("The end date cannot be before the start date.", {
      status: 400,
    });
  }
  const spanDays =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    86_400_000;
  if (!Number.isFinite(spanDays) || spanDays > MAX_RANGE_DAYS) {
    return new Response(`Choose a range of ${MAX_RANGE_DAYS} days or fewer.`, {
      status: 400,
    });
  }
  if (property && !UUID.test(property)) {
    return new Response("That property is not valid.", { status: 400 });
  }

  const data = await getLabourReportData(from, to, property || undefined);
  const report = buildLabourReport(data.shifts, data.timesheets);

  // A UTF-8 BOM, so Excel on Windows does not mangle a non-ASCII name.
  // Written as an escape: a literal U+FEFF is invisible and the bundler
  // strips it from a template literal.
  const body = `\uFEFF${labourReportToCsv(report, data.names)}`;

  const filename = labourCsvFilename(
    from,
    to,
    propertyName.slice(0, 60) || undefined,
  ).replace(/["\\\r\n]/g, "");

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // Labour figures across all staff: never in a shared cache.
      "cache-control": "private, no-store",
    },
  });
}
