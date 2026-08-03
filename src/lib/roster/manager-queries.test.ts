import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseStub, hasFilter, type SupabaseStub } from "@/test/supabase-stub";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => stub.client),
  createServiceRoleClient: vi.fn(() => stub.client),
}));

let stub: SupabaseStub;
beforeEach(() => {
  stub = createSupabaseStub();
  vi.clearAllMocks();
});

const { getConflictContext } = await import("./manager-queries");

const STAFF = "22222222-2222-4222-8222-222222222222";
const COASTAL = "33333333-3333-4333-8333-333333333333";
const LODGE = "44444444-4444-4444-8444-444444444444";
const AROUND = "2026-08-05T09:00:00+10:00";

describe("getConflictContext", () => {
  it("gathers shifts by person, never narrowed to one property", async () => {
    // Both motels share staff, so the shifts this loads are what decides
    // whether a double-booking is seen at all. A `property_id` filter here
    // would hide a clash at the other motel from an engine that is itself
    // property-blind — the conflict would simply never be reported.
    await getConflictContext(STAFF, AROUND);

    const query = stub.onlyOp("shifts", "select");
    expect(hasFilter(query, "eq", "user_id", STAFF)).toBe(true);
    expect(query.filters.some((f) => f.args[0] === "property_id")).toBe(false);
  });

  it("returns shifts from both properties for the engine to weigh", async () => {
    stub.on("shifts", "select", {
      data: [
        {
          id: "s-coastal",
          user_id: STAFF,
          property_id: COASTAL,
          starts_at: "2026-08-05T09:00:00+10:00",
          ends_at: "2026-08-05T17:00:00+10:00",
          properties: { name: "Coastal Comfort" },
        },
        {
          id: "s-lodge",
          user_id: STAFF,
          property_id: LODGE,
          starts_at: "2026-08-05T18:00:00+10:00",
          ends_at: "2026-08-05T22:00:00+10:00",
          properties: { name: "Holiday Lodge" },
        },
      ],
    });

    const context = await getConflictContext(STAFF, AROUND);

    expect(context.existingShifts.map((s) => s.propertyId)).toEqual([
      COASTAL,
      LODGE,
    ]);
    expect(context.existingShifts.map((s) => s.propertyName)).toEqual([
      "Coastal Comfort",
      "Holiday Lodge",
    ]);
  });

  it("looks a fortnight either side, so an adjacent week's shift counts", async () => {
    // A late finish on the Sunday before breaches minimum rest on the
    // Monday. A query bounded to the displayed week cannot see it.
    await getConflictContext(STAFF, AROUND);

    const query = stub.onlyOp("shifts", "select");
    const from = query.filters.find((f) => f.method === "gte");
    const to = query.filters.find((f) => f.method === "lt");

    // 5 Aug 09:00 +10:00 is 4 Aug 23:00 UTC; a fortnight either side of that.
    expect(String(from?.args[1])).toBe("2026-07-21T23:00:00.000Z");
    expect(String(to?.args[1])).toBe("2026-08-18T23:00:00.000Z");
  });

  it("falls back to ten hours when no rest setting is stored", async () => {
    const context = await getConflictContext(STAFF, AROUND);
    expect(context.minimumRestHours).toBe(10);
  });

  it("counts only approved leave and availability", async () => {
    // A pending leave request is not yet a reason to refuse a shift, and a
    // rejected one never was.
    await getConflictContext(STAFF, AROUND);

    expect(
      hasFilter(stub.onlyOp("leave_requests", "select"), "eq", "status", "approved"),
    ).toBe(true);
    expect(
      hasFilter(
        stub.onlyOp("staff_availability", "select"),
        "eq",
        "status",
        "approved",
      ),
    ).toBe(true);
  });

  it("excludes archived shifts, leave and availability", async () => {
    await getConflictContext(STAFF, AROUND);

    for (const table of ["shifts", "leave_requests", "staff_availability"]) {
      expect(hasFilter(stub.onlyOp(table, "select"), "is", "archived_at", null)).toBe(
        true,
      );
    }
  });
});
