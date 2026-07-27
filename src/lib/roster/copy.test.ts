import { describe, expect, it } from "vitest";
import { copyShiftToWeek, copyWeekShifts } from "./copy";

const TZ = "Australia/Sydney";

/** Local wall-clock time of an instant, for readable assertions. */
const localTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(new Date(iso));

const localDate = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: TZ,
  }).format(new Date(iso));

describe("copyShiftToWeek", () => {
  it("keeps the same weekday and local time one week on", () => {
    // Wednesday 5 August 2026, 09:00-17:00 AEST.
    const result = copyShiftToWeek(
      {
        id: "s1",
        startsAt: "2026-08-05T09:00:00+10:00",
        endsAt: "2026-08-05T17:00:00+10:00",
      },
      "2026-08-03",
      "2026-08-10",
      TZ,
    );

    expect(result).not.toBeNull();
    expect(localDate(result!.startsAt)).toBe("2026-08-12"); // still Wednesday
    expect(localTime(result!.startsAt)).toBe("09:00");
    expect(localTime(result!.endsAt)).toBe("17:00");
  });

  it("preserves LOCAL time across the October daylight-saving start", () => {
    // Sydney springs forward on Sunday 4 October 2026. Copying a 09:00 shift
    // from the week before into that week must stay 09:00 local — adding
    // 7 days of milliseconds would land it at 08:00.
    const result = copyShiftToWeek(
      {
        id: "s1",
        startsAt: "2026-09-30T09:00:00+10:00", // Wed, AEST
        endsAt: "2026-09-30T17:00:00+10:00",
      },
      "2026-09-28",
      "2026-10-05",
      TZ,
    );

    expect(localDate(result!.startsAt)).toBe("2026-10-07");
    expect(localTime(result!.startsAt)).toBe("09:00");
    expect(localTime(result!.endsAt)).toBe("17:00");
  });

  it("preserves LOCAL time across the April daylight-saving end", () => {
    // Clocks go back on Sunday 5 April 2026.
    const result = copyShiftToWeek(
      {
        id: "s1",
        startsAt: "2026-04-01T14:00:00+11:00", // Wed, AEDT
        endsAt: "2026-04-01T22:00:00+11:00",
      },
      "2026-03-30",
      "2026-04-06",
      TZ,
    );

    expect(localDate(result!.startsAt)).toBe("2026-04-08");
    expect(localTime(result!.startsAt)).toBe("14:00");
    expect(localTime(result!.endsAt)).toBe("22:00");
  });

  it("keeps an overnight shift spanning to the next local day", () => {
    const result = copyShiftToWeek(
      {
        id: "s1",
        startsAt: "2026-08-05T22:00:00+10:00",
        endsAt: "2026-08-06T06:00:00+10:00",
      },
      "2026-08-03",
      "2026-08-10",
      TZ,
    );

    expect(localDate(result!.startsAt)).toBe("2026-08-12");
    expect(localTime(result!.startsAt)).toBe("22:00");
    expect(localDate(result!.endsAt)).toBe("2026-08-13");
    expect(localTime(result!.endsAt)).toBe("06:00");
  });

  it("copies a Sunday shift to the target Sunday, not forward a day", () => {
    // Sunday is the last day of an Australian roster week; an off-by-one
    // here would silently move it into the following week.
    const result = copyShiftToWeek(
      {
        id: "s1",
        startsAt: "2026-08-09T10:00:00+10:00",
        endsAt: "2026-08-09T16:00:00+10:00",
      },
      "2026-08-03",
      "2026-08-10",
      TZ,
    );
    expect(localDate(result!.startsAt)).toBe("2026-08-16");
  });

  it("copies backwards to an earlier week", () => {
    const result = copyShiftToWeek(
      {
        id: "s1",
        startsAt: "2026-08-12T09:00:00+10:00",
        endsAt: "2026-08-12T17:00:00+10:00",
      },
      "2026-08-10",
      "2026-08-03",
      TZ,
    );
    expect(localDate(result!.startsAt)).toBe("2026-08-05");
    expect(localTime(result!.startsAt)).toBe("09:00");
  });

  it("returns null for a shift outside the source week", () => {
    const result = copyShiftToWeek(
      {
        id: "stray",
        startsAt: "2026-09-01T09:00:00+10:00",
        endsAt: "2026-09-01T17:00:00+10:00",
      },
      "2026-08-03",
      "2026-08-10",
      TZ,
    );
    expect(result).toBeNull();
  });
});

describe("copyWeekShifts", () => {
  it("copies every shift in the week and reports none skipped", () => {
    const shifts = [
      {
        id: "a",
        startsAt: "2026-08-03T09:00:00+10:00",
        endsAt: "2026-08-03T17:00:00+10:00",
      },
      {
        id: "b",
        startsAt: "2026-08-06T12:00:00+10:00",
        endsAt: "2026-08-06T20:00:00+10:00",
      },
    ];

    const { copied, skipped } = copyWeekShifts(
      shifts,
      "2026-08-03",
      "2026-08-10",
      TZ,
    );

    expect(copied).toHaveLength(2);
    expect(skipped).toEqual([]);
    expect(copied.map((c) => c.sourceId)).toEqual(["a", "b"]);
  });

  it("reports shifts outside the week rather than dropping them silently", () => {
    const { copied, skipped } = copyWeekShifts(
      [
        {
          id: "inside",
          startsAt: "2026-08-03T09:00:00+10:00",
          endsAt: "2026-08-03T17:00:00+10:00",
        },
        {
          id: "outside",
          startsAt: "2026-09-03T09:00:00+10:00",
          endsAt: "2026-09-03T17:00:00+10:00",
        },
      ],
      "2026-08-03",
      "2026-08-10",
      TZ,
    );

    expect(copied).toHaveLength(1);
    expect(skipped).toEqual(["outside"]);
  });

  it("handles an empty week without error", () => {
    const { copied, skipped } = copyWeekShifts([], "2026-08-03", "2026-08-10", TZ);
    expect(copied).toEqual([]);
    expect(skipped).toEqual([]);
  });
});
