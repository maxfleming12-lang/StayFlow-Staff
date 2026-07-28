import { describe, expect, it } from "vitest";
import {
  type CandidateShift,
  type ConflictContext,
  findConflicts,
  requiresOverride,
} from "./conflicts";

const COASTAL = "prop-coastal";
const LODGE = "prop-lodge";
const AROHA = "user-aroha";

const baseContext = (over: Partial<ConflictContext> = {}): ConflictContext => ({
  existingShifts: [],
  approvedLeave: [],
  availability: [],
  minimumRestHours: 10,
  crossPropertyMinimumHours: 12,
  timeZone: "Australia/Sydney",
  ...over,
});

const shift = (over: Partial<CandidateShift> = {}): CandidateShift => ({
  id: "new-shift",
  userId: AROHA,
  propertyId: COASTAL,
  startsAt: "2026-08-05T09:00:00+10:00",
  endsAt: "2026-08-05T17:00:00+10:00",
  ...over,
});

describe("unassigned shifts", () => {
  it("produce no conflicts, because an open shift is nobody's yet", () => {
    expect(findConflicts(shift({ userId: null }), baseContext())).toEqual([]);
  });
});

describe("overlapping shifts", () => {
  it("flags a genuine overlap", () => {
    const conflicts = findConflicts(
      shift(),
      baseContext({
        existingShifts: [
          shift({
            id: "other",
            startsAt: "2026-08-05T14:00:00+10:00",
            endsAt: "2026-08-05T20:00:00+10:00",
          }),
        ],
      }),
    );
    expect(conflicts.map((c) => c.kind)).toContain("overlap");
  });

  it("does not flag back-to-back shifts as overlapping", () => {
    // Ending at 17:00 and starting at 17:00 is a handover, not a clash.
    const conflicts = findConflicts(
      shift(),
      baseContext({
        minimumRestHours: 0,
        crossPropertyMinimumHours: undefined,
        existingShifts: [
          shift({
            id: "other",
            startsAt: "2026-08-05T17:00:00+10:00",
            endsAt: "2026-08-05T21:00:00+10:00",
          }),
        ],
      }),
    );
    expect(conflicts.map((c) => c.kind)).not.toContain("overlap");
  });

  it("ignores the shift being edited itself", () => {
    const conflicts = findConflicts(
      shift(),
      baseContext({ existingShifts: [shift()] }),
    );
    expect(conflicts).toEqual([]);
  });

  it("ignores other people's shifts", () => {
    const conflicts = findConflicts(
      shift(),
      baseContext({
        existingShifts: [shift({ id: "other", userId: "someone-else" })],
      }),
    );
    expect(conflicts).toEqual([]);
  });

  it("reports overlap only once, not also as a rest breach", () => {
    const conflicts = findConflicts(
      shift(),
      baseContext({
        existingShifts: [
          shift({
            id: "other",
            startsAt: "2026-08-05T16:00:00+10:00",
            endsAt: "2026-08-05T22:00:00+10:00",
          }),
        ],
      }),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("overlap");
  });
});

describe("minimum rest", () => {
  it("flags a short turnaround after a late finish", () => {
    // Finishes 22:00, next starts 06:00 — eight hours, under the ten-hour rule.
    const conflicts = findConflicts(
      shift({
        startsAt: "2026-08-06T06:00:00+10:00",
        endsAt: "2026-08-06T14:00:00+10:00",
      }),
      baseContext({
        existingShifts: [
          shift({
            id: "late",
            startsAt: "2026-08-05T14:00:00+10:00",
            endsAt: "2026-08-05T22:00:00+10:00",
          }),
        ],
      }),
    );
    const rest = conflicts.find((c) => c.kind === "minimum_rest");
    expect(rest).toBeDefined();
    expect(rest?.message).toContain("8 hours");
    expect(rest?.severity).toBe("warning");
  });

  it("does not flag a full rest gap", () => {
    const conflicts = findConflicts(
      shift({
        startsAt: "2026-08-06T09:00:00+10:00",
        endsAt: "2026-08-06T17:00:00+10:00",
      }),
      baseContext({
        existingShifts: [
          shift({
            id: "yesterday",
            startsAt: "2026-08-05T09:00:00+10:00",
            endsAt: "2026-08-05T17:00:00+10:00",
          }),
        ],
      }),
    );
    expect(conflicts.map((c) => c.kind)).not.toContain("minimum_rest");
  });
});

describe("cross-property turnaround", () => {
  it("flags a tight move between the two motels", () => {
    const conflicts = findConflicts(
      shift({
        propertyId: COASTAL,
        startsAt: "2026-08-06T09:00:00+10:00",
        endsAt: "2026-08-06T17:00:00+10:00",
      }),
      baseContext({
        minimumRestHours: 8,
        crossPropertyMinimumHours: 20,
        existingShifts: [
          shift({
            id: "lodge",
            propertyId: LODGE,
            propertyName: "Holiday Lodge",
            startsAt: "2026-08-05T14:00:00+10:00",
            endsAt: "2026-08-05T22:00:00+10:00",
          }),
        ],
      }),
    );
    const cross = conflicts.find((c) => c.kind === "cross_property_turnaround");
    expect(cross).toBeDefined();
    expect(cross?.message).toContain("Holiday Lodge");
    // Advisory, not a warning — it should not demand an override on its own.
    expect(cross?.severity).toBe("advisory");
  });

  it("does not flag movement within one property", () => {
    const conflicts = findConflicts(
      shift({
        startsAt: "2026-08-06T09:00:00+10:00",
        endsAt: "2026-08-06T17:00:00+10:00",
      }),
      baseContext({
        minimumRestHours: 8,
        crossPropertyMinimumHours: 20,
        existingShifts: [
          shift({
            id: "same",
            propertyId: COASTAL,
            startsAt: "2026-08-05T14:00:00+10:00",
            endsAt: "2026-08-05T22:00:00+10:00",
          }),
        ],
      }),
    );
    expect(conflicts.map((c) => c.kind)).not.toContain(
      "cross_property_turnaround",
    );
  });
});

describe("approved leave", () => {
  it("flags a shift inside a full-day leave period", () => {
    const conflicts = findConflicts(
      shift(),
      baseContext({
        approvedLeave: [
          {
            firstDate: "2026-08-03",
            lastDate: "2026-08-07",
            isPartialDay: false,
          },
        ],
      }),
    );
    expect(conflicts.map((c) => c.kind)).toContain("approved_leave");
  });

  it("does not flag a shift outside the leave dates", () => {
    const conflicts = findConflicts(
      shift(),
      baseContext({
        approvedLeave: [
          {
            firstDate: "2026-08-10",
            lastDate: "2026-08-14",
            isPartialDay: false,
          },
        ],
      }),
    );
    expect(conflicts).toEqual([]);
  });

  it("respects partial-day leave hours", () => {
    // Leave 07:00–11:00 clashes with a 09:00 start.
    const clashing = findConflicts(
      shift(),
      baseContext({
        approvedLeave: [
          {
            firstDate: "2026-08-05",
            lastDate: "2026-08-05",
            isPartialDay: true,
            startTime: "07:00",
            endTime: "11:00",
          },
        ],
      }),
    );
    expect(clashing.map((c) => c.kind)).toContain("approved_leave");

    // Leave 18:00–20:00 does not clash with a 09:00–17:00 shift.
    const clear = findConflicts(
      shift(),
      baseContext({
        approvedLeave: [
          {
            firstDate: "2026-08-05",
            lastDate: "2026-08-05",
            isPartialDay: true,
            startTime: "18:00",
            endTime: "20:00",
          },
        ],
      }),
    );
    expect(clear.map((c) => c.kind)).not.toContain("approved_leave");
  });
});

describe("submitted unavailability", () => {
  it("flags a recurring weekly unavailable day", () => {
    // 2026-08-05 is a Wednesday (day 3).
    const conflicts = findConflicts(
      shift(),
      baseContext({
        availability: [
          {
            dayOfWeek: 3,
            specificDate: null,
            startTime: null,
            endTime: null,
            isAvailable: false,
          },
        ],
      }),
    );
    expect(conflicts.map((c) => c.kind)).toContain("unavailable");
  });

  it("lets a date-specific rule override the recurring pattern", () => {
    const conflicts = findConflicts(
      shift(),
      baseContext({
        availability: [
          {
            dayOfWeek: 3,
            specificDate: null,
            startTime: null,
            endTime: null,
            isAvailable: false,
          },
          {
            dayOfWeek: null,
            specificDate: "2026-08-05",
            startTime: null,
            endTime: null,
            isAvailable: true,
          },
        ],
      }),
    );
    expect(conflicts.map((c) => c.kind)).not.toContain("unavailable");
  });

  it("does not flag an available day", () => {
    const conflicts = findConflicts(
      shift(),
      baseContext({
        availability: [
          {
            dayOfWeek: 3,
            specificDate: null,
            startTime: null,
            endTime: null,
            isAvailable: true,
          },
        ],
      }),
    );
    expect(conflicts).toEqual([]);
  });

  it("reads time-bounded unavailability as property-local, not host-local", () => {
    // 08:00–12:00 unavailable overlaps a 09:00–17:00 shift. Parsed against the
    // host clock instead of the property timezone, this window landed in the
    // Sydney evening on a UTC server and the clash went unreported.
    const clashing = findConflicts(
      shift(),
      baseContext({
        availability: [
          {
            dayOfWeek: 3,
            specificDate: null,
            startTime: "08:00",
            endTime: "12:00",
            isAvailable: false,
          },
        ],
      }),
    );
    expect(clashing.map((c) => c.kind)).toContain("unavailable");

    // 19:00–23:00 genuinely does not overlap that shift.
    const clear = findConflicts(
      shift(),
      baseContext({
        availability: [
          {
            dayOfWeek: 3,
            specificDate: null,
            startTime: "19:00",
            endTime: "23:00",
            isAvailable: false,
          },
        ],
      }),
    );
    expect(clear.map((c) => c.kind)).not.toContain("unavailable");
  });

  it("accepts the seconds form Postgres time columns return", () => {
    const conflicts = findConflicts(
      shift(),
      baseContext({
        availability: [
          {
            dayOfWeek: 3,
            specificDate: null,
            startTime: "08:00:00",
            endTime: "12:00:00",
            isAvailable: false,
          },
        ],
      }),
    );
    expect(conflicts.map((c) => c.kind)).toContain("unavailable");
  });
});

describe("requiresOverride", () => {
  it("is true when a warning is present", () => {
    expect(
      requiresOverride([
        { kind: "overlap", severity: "warning", message: "x" },
      ]),
    ).toBe(true);
  });

  it("is false for advisories alone, which should not demand a reason", () => {
    expect(
      requiresOverride([
        { kind: "unavailable", severity: "advisory", message: "x" },
      ]),
    ).toBe(false);
  });

  it("is false when there is nothing wrong", () => {
    expect(requiresOverride([])).toBe(false);
  });
});
