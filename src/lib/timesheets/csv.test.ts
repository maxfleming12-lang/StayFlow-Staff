import { describe, expect, it } from "vitest";
import { csvFilename, escapeCsvField, timesheetsToCsv } from "./csv";
import type { TimesheetRow } from "./queries";

const row = (over: Partial<TimesheetRow> = {}): TimesheetRow => ({
  id: "t1",
  userId: "u1",
  staffName: "Aroha Whitiora",
  workDate: "2026-07-28",
  propertyName: "Coastal Comfort",
  rosteredStart: null,
  rosteredEnd: null,
  // 9am to 5pm Sydney in July.
  actualStart: "2026-07-27T23:00:00.000Z",
  actualEnd: "2026-07-28T07:00:00.000Z",
  breakMinutes: 30,
  paidHours: 7.5,
  varianceHours: null,
  status: "approved",
  isNoShow: false,
  staffNote: null,
  managerNote: null,
  staffAcknowledgedAt: null,
  lockedAt: null,
  ...over,
});

const dataRows = (csv: string) => csv.trimEnd().split("\r\n").slice(1);
const cells = (line: string) => line.split(",");

describe("escapeCsvField", () => {
  it("leaves ordinary text alone", () => {
    expect(escapeCsvField("Coastal Comfort")).toBe("Coastal Comfort");
  });

  it("quotes fields containing a comma, quote or newline", () => {
    expect(escapeCsvField("Whitiora, Aroha")).toBe('"Whitiora, Aroha"');
    expect(escapeCsvField('He said "no"')).toBe('"He said ""no"""');
    expect(escapeCsvField("line one\nline two")).toBe('"line one\nline two"');
  });

  // Staff and manager notes are free text that lands in a payroll
  // spreadsheet. Excel and Sheets execute a cell beginning with any of
  // these, so they must be neutralised rather than merely quoted.
  it.each(["=", "+", "-", "@"])(
    "neutralises a formula beginning with %s",
    (lead) => {
      expect(escapeCsvField(`${lead}HYPERLINK("http://x","hi")`)).toMatch(
        /^"?'/,
      );
    },
  );

  it("neutralises the classic spreadsheet exploit", () => {
    const attack = '=cmd|\' /C calc\'!A0';
    const escaped = escapeCsvField(attack);
    // Prefixed so the cell is literal text, and quoted for the comma.
    expect(escaped.startsWith('"\'') || escaped.startsWith("'")).toBe(true);
    expect(escaped).not.toMatch(/^=/);
  });

  it("neutralises leading tab and carriage return", () => {
    expect(escapeCsvField("\tsomething")).toMatch(/^"?'/);
    expect(escapeCsvField("\rsomething")).toMatch(/^"?'/);
  });

  it("does not mangle a negative number typed by a person", () => {
    // Still prefixed — correctness for payroll beats prettiness, and a
    // negative variance is written by us as a number, not through here.
    expect(escapeCsvField("-1.5")).toBe("'-1.5");
  });
});

describe("timesheetsToCsv", () => {
  it("writes a header row payroll can read", () => {
    const csv = timesheetsToCsv([]);
    expect(csv.split("\r\n")[0]).toBe(
      "Date,Staff,Property,Started,Finished,Unpaid break (min),Paid hours,Rostered hours,Variance hours,Status,No show,Staff note,Manager note",
    );
  });

  it("renders times in the property timezone, not UTC", () => {
    const [line] = dataRows(timesheetsToCsv([row()]));
    const c = cells(line);
    expect(c[0]).toBe("2026-07-28");
    expect(c[3]).toBe("09:00");
    expect(c[4]).toBe("17:00");
  });

  it("keeps summer times right under daylight saving", () => {
    const [line] = dataRows(
      timesheetsToCsv([
        row({
          workDate: "2026-01-20",
          actualStart: "2026-01-19T22:00:00.000Z",
          actualEnd: "2026-01-20T06:00:00.000Z",
        }),
      ]),
    );
    expect(cells(line)[3]).toBe("09:00");
    expect(cells(line)[4]).toBe("17:00");
  });

  it("writes hours as plain numbers a spreadsheet will sum", () => {
    const [line] = dataRows(timesheetsToCsv([row({ paidHours: 7.5 })]));
    expect(cells(line)[6]).toBe("7.5");
  });

  it("derives rostered hours from the stored window", () => {
    const [line] = dataRows(
      timesheetsToCsv([
        row({
          rosteredStart: "2026-07-27T23:00:00.000Z",
          rosteredEnd: "2026-07-28T07:00:00.000Z",
        }),
      ]),
    );
    expect(cells(line)[7]).toBe("8");
  });

  it("leaves unknown figures blank rather than writing zero", () => {
    const [line] = dataRows(
      timesheetsToCsv([row({ paidHours: null, varianceHours: null })]),
    );
    const c = cells(line);
    // Blank means "not recorded"; 0 would read as "worked nothing".
    expect(c[6]).toBe("");
    expect(c[7]).toBe("");
    expect(c[8]).toBe("");
  });

  it("shows the human status label", () => {
    const [line] = dataRows(timesheetsToCsv([row({ status: "exported" })]));
    expect(cells(line)[9]).toBe("Sent to payroll");
  });

  it("marks a no-show and leaves the column blank otherwise", () => {
    expect(cells(dataRows(timesheetsToCsv([row({ isNoShow: true })]))[0])[10]).toBe(
      "Yes",
    );
    expect(cells(dataRows(timesheetsToCsv([row()]))[0])[10]).toBe("");
  });

  it("survives a note containing commas, quotes and newlines", () => {
    const csv = timesheetsToCsv([
      row({ staffNote: 'Late start, bus was "cancelled"\nsorry' }),
    ]);
    // Header plus ONE record: the embedded newline stayed inside the quoted
    // field rather than splitting the row in two, which is what would
    // shift every later column and corrupt the payroll import.
    expect(csv.trimEnd().split("\r\n")).toHaveLength(2);
    expect(csv).toContain('"Late start, bus was ""cancelled""');
    expect(csv).toContain("sorry");
  });

  it("neutralises a formula hidden in a staff note", () => {
    const csv = timesheetsToCsv([row({ staffNote: "=1+1" })]);
    expect(csv).toContain("'=1+1");
    expect(csv).not.toContain(",=1+1");
  });

  it("writes one line per timesheet plus the header", () => {
    const csv = timesheetsToCsv([row(), row({ id: "t2" }), row({ id: "t3" })]);
    expect(csv.trimEnd().split("\r\n")).toHaveLength(4);
  });

  it("ends with a newline so the last row is not dropped", () => {
    expect(timesheetsToCsv([row()]).endsWith("\r\n")).toBe(true);
  });
});

describe("csvFilename", () => {
  it("names the file by period", () => {
    expect(csvFilename("2026-07-13", "2026-07-26")).toBe(
      "timesheets-2026-07-13-to-2026-07-26.csv",
    );
  });

  it("includes a slugged property when one is chosen", () => {
    expect(csvFilename("2026-07-13", "2026-07-26", "Coastal Comfort")).toBe(
      "timesheets-coastal-comfort-2026-07-13-to-2026-07-26.csv",
    );
  });

  it("produces a safe filename from an awkward property name", () => {
    expect(csvFilename("2026-07-13", "2026-07-26", "Holiday Lodge (Motor Inn)")).toBe(
      "timesheets-holiday-lodge-motor-inn-2026-07-13-to-2026-07-26.csv",
    );
  });
});
