import { describe, expect, it } from "vitest";
import { labourCsvFilename, labourReportToCsv } from "./csv";
import { buildLabourReport } from "./labour";

const AROHA = "user-aroha";
const names = new Map([[AROHA, "Aroha Whitiora"]]);

const report = () =>
  buildLabourReport(
    [
      {
        id: "s1",
        userId: AROHA,
        propertyId: "p1",
        startsAt: "2026-07-27T23:00:00.000Z",
        endsAt: "2026-07-28T07:00:00.000Z",
        unpaidBreakMinutes: 30,
      },
    ],
    [
      {
        id: "t1",
        userId: AROHA,
        propertyId: "p1",
        workDate: "2026-07-28",
        paidHours: 8,
        isNoShow: false,
        actualStart: "2026-07-27T23:00:00.000Z",
        actualEnd: "2026-07-28T07:00:00.000Z",
      },
    ],
  );

const lines = (csv: string) => csv.trimEnd().split("\r\n");

describe("labourReportToCsv", () => {
  it("writes a header, a row per person, and a totals row", () => {
    const rows = lines(labourReportToCsv(report(), names));

    expect(rows[0]).toBe(
      "Staff,Rostered hours,Worked hours,Variance hours,Shifts,Timesheets,No shows,Missing clock-outs",
    );
    expect(rows[1]).toBe("Aroha Whitiora,7.5,8,0.5,1,1,0,0");
    expect(rows).toHaveLength(3);
  });

  it("labels the totals row so it cannot be mistaken for a person", () => {
    const rows = lines(labourReportToCsv(report(), names));

    // Sorting the sheet by name must not bury it among the staff.
    expect(rows[2].startsWith("TOTAL,")).toBe(true);
  });

  it("inherits the formula-injection guard from the timesheet export", () => {
    const csv = labourReportToCsv(
      report(),
      new Map([[AROHA, "=HYPERLINK(\"http://x\",\"click\")"]]),
    );

    // A staff name is free text a manager typed, and it lands in Excel.
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it("quotes a name containing a comma", () => {
    const csv = labourReportToCsv(report(), new Map([[AROHA, "Whitiora, Aroha"]]));
    expect(csv).toContain('"Whitiora, Aroha"');
    // Still one data row: the comma did not split the record.
    expect(lines(csv)).toHaveLength(3);
  });

  it("names an unknown person rather than leaving the cell blank", () => {
    const csv = labourReportToCsv(report(), new Map());
    expect(lines(csv)[1].startsWith("Unknown,")).toBe(true);
  });

  it("writes just a header and an empty total for an empty period", () => {
    const rows = lines(labourReportToCsv(buildLabourReport([], []), new Map()));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe("TOTAL,0,0,0,0,,0,0");
  });
});

describe("labourCsvFilename", () => {
  it("names the file by period", () => {
    expect(labourCsvFilename("2026-07-13", "2026-07-26")).toBe(
      "labour-report-2026-07-13-to-2026-07-26.csv",
    );
  });

  it("includes a slugged property when one is chosen", () => {
    expect(labourCsvFilename("2026-07-13", "2026-07-26", "Holiday Lodge (Motor Inn)")).toBe(
      "labour-report-holiday-lodge-motor-inn-2026-07-13-to-2026-07-26.csv",
    );
  });
});
