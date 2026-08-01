import { escapeCsvField } from "@/lib/timesheets/csv";
import type { LabourReport } from "./labour";

/**
 * The labour report as CSV.
 *
 * Reuses `escapeCsvField` from the timesheet export rather than repeating
 * it — that function carries the formula-injection guard, and a second
 * implementation would be a second thing to remember to protect.
 */

const COLUMNS = [
  "Staff",
  "Rostered hours",
  "Worked hours",
  "Variance hours",
  "Shifts",
  "Timesheets",
  "No shows",
  "Missing clock-outs",
] as const;

export function labourReportToCsv(
  report: LabourReport,
  names: Map<string, string>,
): string {
  const lines = [COLUMNS.map(escapeCsvField).join(",")];

  for (const row of report.people) {
    lines.push(
      [
        names.get(row.userId) ?? "Unknown",
        String(row.rosteredHours),
        String(row.workedHours),
        String(row.varianceHours),
        String(row.shiftCount),
        String(row.timesheetCount),
        String(row.noShows),
        String(row.missingClockOuts),
      ]
        .map(escapeCsvField)
        .join(","),
    );
  }

  // A totals row, labelled so it cannot be mistaken for a person and cannot
  // be sorted into the middle of the data by accident.
  lines.push(
    [
      "TOTAL",
      String(report.totals.rosteredHours),
      String(report.totals.workedHours),
      String(report.totals.varianceHours),
      String(report.totals.shiftCount),
      "",
      String(report.totals.noShows),
      String(report.totals.missingClockOuts),
    ]
      .map(escapeCsvField)
      .join(","),
  );

  return `${lines.join("\r\n")}\r\n`;
}

/** A filename payroll can file without renaming it. */
export function labourCsvFilename(
  fromDate: string,
  toDate: string,
  propertyName?: string,
): string {
  const scope = propertyName
    ? `-${propertyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`
    : "";
  return `labour-report${scope}-${fromDate}-to-${toDate}.csv`;
}
