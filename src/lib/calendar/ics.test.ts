import { describe, expect, it } from "vitest";
import { buildCalendar, escapeText, foldLine, formatIcsDate } from "./ics";

describe("escapeText", () => {
  it("escapes semicolons and commas", () => {
    expect(escapeText("Rooms 1,2; top floor")).toBe(
      "Rooms 1\\,2\\; top floor",
    );
  });

  it("turns newlines into the literal \\n sequence", () => {
    expect(escapeText("Line one\nLine two")).toBe("Line one\\nLine two");
    expect(escapeText("Windows\r\nstyle")).toBe("Windows\\nstyle");
  });

  it("escapes backslashes first, so later escapes are not double-escaped", () => {
    // Naively replacing ";" before "\" would corrupt this.
    expect(escapeText("a\\b;c")).toBe("a\\\\b\\;c");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeText("Housekeeping shift")).toBe("Housekeeping shift");
  });
});

describe("foldLine", () => {
  it("leaves a short line alone", () => {
    expect(foldLine("SUMMARY:Short")).toBe("SUMMARY:Short");
  });

  it("folds a long line with CRLF and a leading space", () => {
    const line = "DESCRIPTION:" + "a".repeat(200);
    const folded = foldLine(line);
    expect(folded).toContain("\r\n ");
    for (const segment of folded.split("\r\n")) {
      // Continuation segments carry a leading space that counts toward 75.
      expect(new TextEncoder().encode(segment).length).toBeLessThanOrEqual(75);
    }
  });

  it("never splits a multi-byte character", () => {
    // A café note or an emoji is enough to produce an invalid feed if the
    // fold slices by character index rather than UTF-8 bytes.
    const line = "DESCRIPTION:" + "café ☕ ".repeat(20);
    const folded = foldLine(line);
    const rejoined = folded.split("\r\n ").join("");
    expect(rejoined).toBe(line);
    expect(folded).not.toContain("�");
  });

  it("round-trips exactly, so unfolding restores the original", () => {
    const line = "DESCRIPTION:" + "x".repeat(300);
    expect(foldLine(line).split("\r\n ").join("")).toBe(line);
  });
});

describe("formatIcsDate", () => {
  it("formats an instant as basic UTC", () => {
    expect(formatIcsDate("2026-08-03T09:00:00+10:00")).toBe("20260802T230000Z");
  });

  it("accepts a Date as well as a string", () => {
    expect(formatIcsDate(new Date("2026-08-03T00:00:00Z"))).toBe(
      "20260803T000000Z",
    );
  });
});

describe("buildCalendar", () => {
  const now = new Date("2026-07-27T00:00:00Z");

  it("produces a well-formed empty calendar", () => {
    const ics = buildCalendar({ calendarName: "My roster", events: [], now });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("uses CRLF line endings throughout, never bare LF", () => {
    const ics = buildCalendar({
      calendarName: "My roster",
      events: [
        {
          uid: "shift-1@stayflow",
          startsAt: "2026-08-03T09:00:00+10:00",
          endsAt: "2026-08-03T17:00:00+10:00",
          summary: "Housekeeping",
        },
      ],
      now,
    });
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("emits one VEVENT per shift with matching BEGIN and END", () => {
    const ics = buildCalendar({
      calendarName: "My roster",
      events: [1, 2, 3].map((i) => ({
        uid: `shift-${i}@stayflow`,
        startsAt: "2026-08-03T09:00:00+10:00",
        endsAt: "2026-08-03T17:00:00+10:00",
        summary: `Shift ${i}`,
      })),
      now,
    });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics.match(/END:VEVENT/g)).toHaveLength(3);
  });

  it("omits optional fields rather than emitting empty ones", () => {
    const ics = buildCalendar({
      calendarName: "My roster",
      events: [
        {
          uid: "u@stayflow",
          startsAt: "2026-08-03T09:00:00+10:00",
          endsAt: "2026-08-03T17:00:00+10:00",
          summary: "Shift",
          location: null,
          description: null,
        },
      ],
      now,
    });
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("DESCRIPTION:");
  });

  it("escapes a note containing punctuation that would break parsing", () => {
    const ics = buildCalendar({
      calendarName: "My roster",
      events: [
        {
          uid: "u@stayflow",
          startsAt: "2026-08-03T09:00:00+10:00",
          endsAt: "2026-08-03T17:00:00+10:00",
          summary: "Shift",
          description: "Rooms 1,2; then linen",
        },
      ],
      now,
    });
    expect(ics).toContain("Rooms 1\\,2\\; then linen");
  });
});
