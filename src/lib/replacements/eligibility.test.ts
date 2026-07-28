import { describe, expect, it } from "vitest";
import type { ConflictContext } from "@/lib/roster/conflicts";
import {
  canTransition,
  findEligibleStaff,
  isSettled,
  type EligibleStaff,
} from "./eligibility";

const COASTAL = "prop-coastal";
const LODGE = "prop-lodge";

const shift = {
  id: "shift-1",
  userId: "aroha",
  propertyId: COASTAL,
  startsAt: "2026-08-05T09:00:00+10:00",
  endsAt: "2026-08-05T17:00:00+10:00",
};

const person = (
  id: string,
  over: Partial<EligibleStaff> = {},
): EligibleStaff => ({
  id,
  displayName: id,
  jobTitle: "Room Attendant",
  propertyIds: [COASTAL],
  isActive: true,
  ...over,
});

const emptyContext = (): ConflictContext => ({
  existingShifts: [],
  approvedLeave: [],
  availability: [],
  minimumRestHours: 10,
  timeZone: "Australia/Sydney",
});

describe("findEligibleStaff — hard rules", () => {
  it("excludes the person giving the shift away", () => {
    const result = findEligibleStaff({
      shift,
      excludeUserId: "aroha",
      workforce: [person("aroha"), person("liam")],
      contextFor: () => emptyContext(),
    });
    expect(result.map((r) => r.staff.id)).toEqual(["liam"]);
  });

  it("excludes anyone without access to the shift's property", () => {
    const result = findEligibleStaff({
      shift,
      excludeUserId: null,
      workforce: [person("liam"), person("sofia", { propertyIds: [LODGE] })],
      contextFor: () => emptyContext(),
    });
    expect(result.map((r) => r.staff.id)).toEqual(["liam"]);
  });

  it("excludes inactive staff", () => {
    const result = findEligibleStaff({
      shift,
      excludeUserId: null,
      workforce: [person("liam"), person("jack", { isActive: false })],
      contextFor: () => emptyContext(),
    });
    expect(result.map((r) => r.staff.id)).toEqual(["liam"]);
  });

  it("includes someone with access to several properties", () => {
    const result = findEligibleStaff({
      shift,
      excludeUserId: null,
      workforce: [person("dan", { propertyIds: [COASTAL, LODGE] })],
      contextFor: () => emptyContext(),
    });
    expect(result).toHaveLength(1);
  });
});

describe("findEligibleStaff — soft rules", () => {
  it("keeps a clashing person on the list but warns", () => {
    // Removing them silently would hide the only available cover on a
    // Saturday, which is exactly when a manager needs to see the option.
    const result = findEligibleStaff({
      shift,
      excludeUserId: null,
      workforce: [person("liam")],
      contextFor: () => ({
        ...emptyContext(),
        existingShifts: [
          {
            id: "other",
            userId: "liam",
            propertyId: COASTAL,
            startsAt: "2026-08-05T14:00:00+10:00",
            endsAt: "2026-08-05T20:00:00+10:00",
          },
        ],
      }),
    });
    expect(result).toHaveLength(1);
    expect(result[0].warnings.join(" ")).toContain("Overlaps");
  });

  it("warns when the candidate has approved leave", () => {
    const result = findEligibleStaff({
      shift,
      excludeUserId: null,
      workforce: [person("liam")],
      contextFor: () => ({
        ...emptyContext(),
        approvedLeave: [
          { firstDate: "2026-08-03", lastDate: "2026-08-07", isPartialDay: false },
        ],
      }),
    });
    expect(result[0].warnings.join(" ")).toContain("approved leave");
  });

  it("sorts unencumbered people above warned ones", () => {
    const result = findEligibleStaff({
      shift,
      excludeUserId: null,
      workforce: [person("zoe"), person("liam")],
      contextFor: (id) =>
        id === "liam"
          ? {
              ...emptyContext(),
              approvedLeave: [
                {
                  firstDate: "2026-08-05",
                  lastDate: "2026-08-05",
                  isPartialDay: false,
                },
              ],
            }
          : emptyContext(),
    });
    // Zoe is clear despite sorting later alphabetically.
    expect(result.map((r) => r.staff.id)).toEqual(["zoe", "liam"]);
  });

  it("sorts alphabetically when warnings are equal", () => {
    const result = findEligibleStaff({
      shift,
      excludeUserId: null,
      workforce: [person("zoe"), person("liam"), person("aaron")],
      contextFor: () => emptyContext(),
    });
    expect(result.map((r) => r.staff.id)).toEqual(["aaron", "liam", "zoe"]);
  });

  it("copes with no conflict context available", () => {
    const result = findEligibleStaff({
      shift,
      excludeUserId: null,
      workforce: [person("liam")],
      contextFor: () => null,
    });
    expect(result[0].warnings).toEqual([]);
  });
});

describe("canTransition", () => {
  it("allows the normal path through the state machine", () => {
    expect(canTransition("requested", "offered")).toBe(true);
    expect(canTransition("offered", "claimed")).toBe(true);
    expect(canTransition("claimed", "approved")).toBe(true);
  });

  it("allows re-offering a claim the manager did not accept", () => {
    expect(canTransition("claimed", "offered")).toBe(true);
  });

  it("refuses to walk a settled replacement backwards", () => {
    // Reopening an approved swap after the roster was rebuilt around it.
    expect(canTransition("approved", "offered")).toBe(false);
    expect(canTransition("rejected", "requested")).toBe(false);
    expect(canTransition("withdrawn", "offered")).toBe(false);
  });

  it("refuses to skip straight from requested to approved", () => {
    expect(canTransition("requested", "approved")).toBe(false);
  });

  it("refuses an unknown status", () => {
    expect(canTransition("nonsense", "approved")).toBe(false);
  });
});

describe("isSettled", () => {
  it("recognises terminal states", () => {
    expect(isSettled("approved")).toBe(true);
    expect(isSettled("rejected")).toBe(true);
    expect(isSettled("withdrawn")).toBe(true);
  });

  it("does not treat in-flight states as settled", () => {
    expect(isSettled("requested")).toBe(false);
    expect(isSettled("offered")).toBe(false);
    expect(isSettled("claimed")).toBe(false);
  });
});
