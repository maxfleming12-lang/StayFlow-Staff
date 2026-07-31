import { formatShortDate, formatTime, formatHours } from "@/lib/format";
import { TIMESHEET_STATUS_LABEL } from "@/lib/timesheets/generate";
import type { TimesheetRow } from "@/lib/timesheets/queries";

/**
 * The paper version of a pay period.
 *
 * Hidden on screen and revealed only by the print stylesheet. The review
 * cards are the right shape for deciding things — tickboxes, edit forms,
 * approve buttons — and the wrong shape entirely for a sheet that goes in
 * the payroll folder, where what matters is fitting a fortnight legibly.
 *
 * A signature column is included because both motels keep a countersigned
 * paper copy, which is also the fallback when the tablet is down.
 */
export function TimesheetPrintTable({
  sheets,
  heading,
}: {
  sheets: TimesheetRow[];
  heading: string;
}) {
  const totalHours = sheets.reduce((sum, s) => sum + (s.paidHours ?? 0), 0);

  return (
    <div className="timesheet-print-only timesheet-print-root hidden">
      <h2 className="text-base font-semibold">{heading}</h2>
      <p className="mt-0.5 text-xs">
        {sheets.length} timesheet{sheets.length === 1 ? "" : "s"} ·{" "}
        {formatHours(totalHours)} total
      </p>

      <table className="mt-2">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Staff</th>
            <th scope="col">Property</th>
            <th scope="col">Started</th>
            <th scope="col">Finished</th>
            <th scope="col">Break</th>
            <th scope="col">Paid hours</th>
            <th scope="col">Status</th>
            <th scope="col">Signature</th>
          </tr>
        </thead>
        <tbody>
          {sheets.map((sheet) => (
            <tr key={sheet.id}>
              <td>{formatShortDate(`${sheet.workDate}T00:00:00Z`)}</td>
              <td>{sheet.staffName}</td>
              <td>{sheet.propertyName}</td>
              <td>{sheet.actualStart ? formatTime(sheet.actualStart) : "—"}</td>
              <td>{sheet.actualEnd ? formatTime(sheet.actualEnd) : "—"}</td>
              <td>{sheet.breakMinutes ? `${sheet.breakMinutes} min` : "—"}</td>
              <td>
                {sheet.paidHours != null ? formatHours(sheet.paidHours) : "—"}
                {sheet.isNoShow ? " (no show)" : ""}
              </td>
              <td>{TIMESHEET_STATUS_LABEL[sheet.status] ?? sheet.status}</td>
              {/* Left blank deliberately — this is signed by hand. */}
              <td />
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 text-[8pt]">
        Paid hours are an estimate for payroll to check. They are not award
        interpreted: overtime, penalty rates, loadings and allowances are not
        calculated here.
      </p>
    </div>
  );
}
