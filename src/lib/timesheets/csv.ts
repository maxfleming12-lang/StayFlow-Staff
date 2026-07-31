import { DEFAULT_TIMEZONE } from "@/lib/format";
import { localTimeOf } from "./entry";
import { TIMESHEET_STATUS_LABEL } from "./generate";
import type { TimesheetRow } from "./queries";

/**
 * Timesheets as CSV, for payroll.
 *
 * Payroll is done in a spreadsheet at both motels, so this has to open
 * cleanly in Excel and Google Sheets rather than merely be valid CSV.
 *
 * Kept pure and separate from the route handler so it can be tested.
 */

/** Columns, in the order payroll reads them. */
const COLUMNS = [
  "Date",
  "Staff",
  "Property",
  "Started",
  "Finished",
  "Unpaid break (min)",
  "Paid hours",
  "Rostered hours",
  "Variance hours",
  "Status",
  "No show",
  "Staff note",
  "Manager note",
] as const;

/**
 * Escape one field.
 *
 * Two separate jobs:
 *
 *  1. RFC 4180 quoting, so commas, quotes and newlines survive.
 *  2. Neutralising FORMULA INJECTION. A field beginning `=`, `+`, `-`, `@`
 *     or a control character is executed as a formula by Excel and Google
 *     Sheets. Staff notes and manager notes are free text typed by users, so
 *     a note of `=HYPERLINK("http://…","Click")` would become a live link in
 *     the payroll spreadsheet. Prefixing with an apostrophe makes the cell
 *     literal text; Excel hides the apostrophe when displaying it.
 */
export function escapeCsvField(value: string): string {
  const dangerous = /^[=+\-@\t\r]/.test(value);
  const text = dangerous ? `'${value}` : value;

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Hours a shift was rostered for, from the stored window. */
function rosteredHoursOf(row: TimesheetRow): number | null {
  if (!row.rosteredStart || !row.rosteredEnd) return null;
  const ms = Date.parse(row.rosteredEnd) - Date.parse(row.rosteredStart);
  if (Number.isNaN(ms)) return null;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/** A number for a spreadsheet: plain digits, or blank when unknown. */
function num(value: number | null): string {
  return value == null ? "" : String(value);
}

/**
 * Build the CSV body for a set of timesheets.
 *
 * Times are rendered in the property's timezone, so a 9am start reads as
 * 09:00 rather than the UTC instant stored. Dates stay ISO (yyyy-mm-dd)
 * because that is the one format spreadsheets sort correctly everywhere,
 * and payroll sorts by date.
 */
export function timesheetsToCsv(
  rows: TimesheetRow[],
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const lines = [COLUMNS.map(escapeCsvField).join(",")];

  for (const row of rows) {
    lines.push(
      [
        row.workDate,
        row.staffName,
        row.propertyName,
        row.actualStart ? localTimeOf(row.actualStart, timeZone) : "",
        row.actualEnd ? localTimeOf(row.actualEnd, timeZone) : "",
        String(row.breakMinutes),
        num(row.paidHours),
        num(rosteredHoursOf(row)),
        num(row.varianceHours),
        TIMESHEET_STATUS_LABEL[row.status] ?? row.status,
        row.isNoShow ? "Yes" : "",
        row.staffNote ?? "",
        row.managerNote ?? "",
      ]
        .map(escapeCsvField)
        .join(","),
    );
  }

  // A trailing newline: some tools drop the last row without one.
  return `${lines.join("\r\n")}\r\n`;
}

/** A filename payroll can file without renaming it. */
export function csvFilename(
  fromDate: string,
  toDate: string,
  propertyName?: string,
): string {
  const scope = propertyName
    ? `-${propertyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`
    : "";
  return `timesheets${scope}-${fromDate}-to-${toDate}.csv`;
}
