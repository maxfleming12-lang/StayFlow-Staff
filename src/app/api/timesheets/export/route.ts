import { requireUser } from "@/lib/auth/session";
import { getTimesheetsForExport } from "@/lib/timesheets/queries";
import { csvFilename, timesheetsToCsv } from "@/lib/timesheets/csv";

/**
 * Download a pay period as CSV.
 *
 * A route handler rather than a server action: this returns a file, and the
 * browser needs a real response with a Content-Disposition to save it.
 *
 * Authorisation is ROW LEVEL SECURITY, not the role check. Any signed-in
 * user may call this, and the database decides what they get:
 * `timesheets_select_self` gives a staff member their own rows and nothing
 * else, `timesheets_select_management` gives a manager the properties they
 * manage. So the same endpoint serves a staff member taking a copy of their
 * own hours and a manager exporting a pay period, and neither can widen it
 * by editing the query string — a staff member passing another property's
 * id still matches only their own rows.
 *
 * Downloading deliberately does NOT mark anything as sent to payroll. A
 * manager will export a period several times while checking it, and stamping
 * `exported_at` on the first download would lock the rows against correction
 * before anyone had agreed the figures.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Longest range accepted, in days.
 *
 * The query pages until it runs out of rows, so an unbounded range is a way
 * to make the server work very hard from a single request. Two years is far
 * more than any pay period and well past the point of usefulness.
 */
const MAX_RANGE_DAYS = 730;

export async function GET(request: Request): Promise<Response> {
  await requireUser();

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
  const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(spanDays) || spanDays > MAX_RANGE_DAYS) {
    return new Response(
      `Choose a range of ${MAX_RANGE_DAYS} days or fewer.`,
      { status: 400 },
    );
  }
  if (property && !UUID.test(property)) {
    return new Response("That property is not valid.", { status: 400 });
  }

  const rows = await getTimesheetsForExport(from, to, property || undefined);
  const csv = timesheetsToCsv(rows);

  // A UTF-8 BOM. Without it Excel on Windows reads the file as the system
  // codepage and mangles any non-ASCII name — which at these two motels is
  // not hypothetical.
  //
  // Written as an escape, not a literal: a literal U+FEFF is invisible in an
  // editor and the bundler strips it from a template literal, so the BOM
  // silently never reached the response.
  const body = `\uFEFF${csv}`;

  // The filename is quoted and stripped of anything that could break the
  // header, since part of it comes from the query string.
  const filename = csvFilename(
    from,
    to,
    propertyName.slice(0, 60) || undefined,
  ).replace(/["\\\r\n]/g, "");

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // Pay data: never store it in a shared cache.
      "cache-control": "private, no-store",
    },
  });
}
