import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANAGER,
  createSupabaseStub,
  formData,
  hasFilter,
  type SupabaseStub,
} from "@/test/supabase-stub";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/notifications/deliver", () => ({
  notify: vi.fn(async () => ({ recorded: 0, pushed: 0, pruned: 0 })),
}));
vi.mock("@/lib/auth/session", () => ({
  requireRole: vi.fn(async () => MANAGER),
  requireUser: vi.fn(async () => MANAGER),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => stub.client),
  createServiceRoleClient: vi.fn(() => stub.client),
}));
// Conflict detection has its own tests and its own queries; stubbing the
// boundary keeps these tests about what saveShift itself writes.
vi.mock("./manager-queries", () => ({
  getConflictContext: vi.fn(async () => ({
    existingShifts: [],
    approvedLeave: [],
    availability: [],
    minimumRestHours: 10,
    timeZone: "Australia/Sydney",
  })),
}));

let stub: SupabaseStub;
beforeEach(() => {
  stub = createSupabaseStub();
  vi.clearAllMocks();
});

const {
  removeShift,
  saveShift,
  assignOpenShift,
  publishRoster,
  clearRosterWeek,
} = await import("./manager-actions");
const { notify } = await import("@/lib/notifications/deliver");
const { getConflictContext } = await import("./manager-queries");
const { requireRole } = await import("@/lib/auth/session");

const SHIFT = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const PROPERTY = "33333333-3333-4333-8333-333333333333";

describe("removeShift", () => {
  it("archives an unfilled shift rather than deleting the row", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: null, status: "published", archived_at: null },
    });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    const result = await removeShift({}, formData({ shiftId: SHIFT }));

    expect(result.success).toBe("Shift removed.");
    const update = stub.onlyOp("shifts", "update");
    expect(update.payload).toMatchObject({ archived_at: expect.any(String) });
    // Soft delete only — a hard delete would orphan attendance and audit rows.
    expect(stub.opsFor("shifts", "delete")).toHaveLength(0);
  });

  it("archives an assigned DRAFT shift, which staff cannot see yet", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: STAFF, status: "draft", archived_at: null },
    });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    expect((await removeShift({}, formData({ shiftId: SHIFT }))).success).toBe(
      "Shift removed.",
    );
  });

  it("refuses a published shift that somebody is rostered on", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: STAFF, status: "published", archived_at: null },
    });

    const result = await removeShift({}, formData({ shiftId: SHIFT }));

    expect(result.error).toMatch(/published and assigned/i);
    expect(result.success).toBeUndefined();
    // Nothing was written.
    expect(stub.opsFor("shifts", "update")).toHaveLength(0);
  });

  it("refuses an unfilled shift somebody has claimed", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: null, status: "published", archived_at: null },
    });
    stub.on("open_shift_offers", "select", { data: { id: "offer-1" } });

    const result = await removeShift({}, formData({ shiftId: SHIFT }));

    expect(result.error).toMatch(/claimed/i);
    expect(stub.opsFor("shifts", "update")).toHaveLength(0);
  });

  it("only looks for CLAIMED offers, not merely offered ones", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: null, status: "draft", archived_at: null },
    });
    stub.on("open_shift_offers", "select", { data: null });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await removeShift({}, formData({ shiftId: SHIFT }));

    const offers = stub.onlyOp("open_shift_offers", "select");
    expect(hasFilter(offers, "eq", "status", "claimed")).toBe(true);
  });

  it("constrains the write so the database settles a mid-air change", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: null, status: "draft", archived_at: null },
    });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await removeShift({}, formData({ shiftId: SHIFT }));

    // The read cannot be trusted on its own: the shift may be assigned or
    // published between it and the write. Both conditions must be in the
    // WHERE clause, or a live shift could be archived from under someone.
    const update = stub.onlyOp("shifts", "update");
    expect(hasFilter(update, "eq", "id", SHIFT)).toBe(true);
    expect(hasFilter(update, "is", "archived_at", null)).toBe(true);
    expect(hasFilter(update, "or", "user_id.is.null,status.eq.draft")).toBe(true);
  });

  it("reports a lost race rather than claiming success", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: null, status: "draft", archived_at: null },
    });
    // Zero rows matched: it was assigned and published in the meantime.
    stub.on("shifts", "update", { data: null });

    const result = await removeShift({}, formData({ shiftId: SHIFT }));

    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(/changed while you were looking at it/i);
  });

  it("refuses one that is already archived", async () => {
    stub.on("shifts", "select", {
      data: {
        id: SHIFT,
        user_id: null,
        status: "draft",
        archived_at: "2026-07-01T00:00:00.000Z",
      },
    });

    const result = await removeShift({}, formData({ shiftId: SHIFT }));

    expect(result.error).toMatch(/already been removed/i);
    expect(stub.opsFor("shifts", "update")).toHaveLength(0);
  });

  it("rejects an id that is not a uuid without touching the database", async () => {
    const result = await removeShift({}, formData({ shiftId: "not-a-uuid" }));

    expect(result.error).toMatch(/could not be identified/i);
    expect(stub.operations).toHaveLength(0);
  });
});

describe("saveShift when editing", () => {
  const editForm = (over: Record<string, string> = {}) =>
    formData({
      shiftId: SHIFT,
      propertyId: PROPERTY,
      userId: STAFF,
      startsAt: "2026-07-28T09:00",
      endsAt: "2026-07-28T17:00",
      breakMinutes: "30",
      ...over,
    });

  it("stores the times as property-local wall clock", async () => {
    stub.on("shifts", "select", { data: { status: "draft" } });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await saveShift({}, editForm());

    const update = stub.onlyOp("shifts", "update");
    // 9am Sydney in July is 23:00 UTC the day before, not 09:00 UTC.
    expect(update.payload).toMatchObject({
      starts_at: "2026-07-27T23:00:00.000Z",
      ends_at: "2026-07-28T07:00:00.000Z",
    });
  });

  it("clears an existing break when the manager sets it to zero", async () => {
    stub.on("shifts", "select", { data: { status: "draft" } });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await saveShift({}, editForm({ breakMinutes: "0" }));

    // The delete must run unconditionally. Guarding it on a non-zero break
    // left the old break in place, so payroll kept deducting it.
    expect(stub.opsFor("shift_breaks", "delete")).toHaveLength(1);
    expect(stub.opsFor("shift_breaks", "insert")).toHaveLength(0);
  });

  it("replaces the break wholesale when one is given", async () => {
    stub.on("shifts", "select", { data: { status: "draft" } });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await saveShift({}, editForm({ breakMinutes: "45" }));

    expect(stub.opsFor("shift_breaks", "delete")).toHaveLength(1);
    expect(stub.onlyOp("shift_breaks", "insert").payload).toMatchObject({
      shift_id: SHIFT,
      duration_minutes: 45,
    });
  });

  it("tells the staff member when a PUBLISHED shift changes", async () => {
    stub.on("shifts", "select", { data: { status: "published" } });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await saveShift({}, editForm());

    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0][0]).toMatchObject({
      userIds: [STAFF],
      deepLink: "/roster",
    });
    // And their acknowledgement is reset, so they confirm the new times.
    expect(stub.onlyOp("shift_acknowledgements", "update").payload).toMatchObject(
      { status: "pending" },
    );
  });

  it("stays quiet when a DRAFT changes, since nobody has seen it", async () => {
    stub.on("shifts", "select", { data: { status: "draft" } });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await saveShift({}, editForm());

    expect(notify).not.toHaveBeenCalled();
    expect(stub.opsFor("shift_acknowledgements")).toHaveLength(0);
  });

  it("does not notify when an unassigned shift changes", async () => {
    stub.on("shifts", "select", { data: { status: "published" } });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await saveShift({}, editForm({ userId: "" }));

    expect(notify).not.toHaveBeenCalled();
  });

  it("refuses to edit a shift that has been removed", async () => {
    stub.on("shifts", "select", { data: null });

    const result = await saveShift({}, editForm());

    expect(result.error).toMatch(/no longer exists/i);
    expect(stub.opsFor("shifts", "update")).toHaveLength(0);
  });

  it("rejects a finish at or before the start", async () => {
    const result = await saveShift(
      {},
      editForm({ startsAt: "2026-07-28T17:00", endsAt: "2026-07-28T09:00" }),
    );

    expect(result.fieldErrors?.endsAt).toMatch(/after the start/i);
    expect(stub.operations).toHaveLength(0);
  });
});

describe("assignOpenShift", () => {
  const assign = (over: Record<string, string> = {}) =>
    formData({ shiftId: SHIFT, userId: STAFF, ...over });

  const openShift = (over: Record<string, unknown> = {}) => ({
    id: SHIFT,
    property_id: PROPERTY,
    starts_at: "2026-07-27T23:00:00.000Z",
    ends_at: "2026-07-28T07:00:00.000Z",
    status: "draft",
    user_id: null,
    ...over,
  });

  it("assigns the person and clears the open-shift flag", async () => {
    stub.on("shifts", "select", { data: openShift() });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    const result = await assignOpenShift({}, assign());

    expect(result.success).toBe("Shift assigned.");
    expect(stub.onlyOp("shifts", "update").payload).toEqual({
      user_id: STAFF,
      is_open_shift: false,
    });
  });

  it("lets the database settle a race with another manager", async () => {
    stub.on("shifts", "select", { data: openShift() });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await assignOpenShift({}, assign());

    // Without `user_id is null` in the WHERE clause, two managers assigning
    // at once would both succeed and the later one would silently win.
    expect(hasFilter(stub.onlyOp("shifts", "update"), "is", "user_id", null)).toBe(
      true,
    );
  });

  it("reports a lost race rather than claiming success", async () => {
    stub.on("shifts", "select", { data: openShift() });
    stub.on("shifts", "update", { data: null });

    const result = await assignOpenShift({}, assign());

    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(/assigned by someone else/i);
  });

  it("refuses a shift that already has somebody on it", async () => {
    stub.on("shifts", "select", { data: openShift({ user_id: "someone" }) });

    const result = await assignOpenShift({}, assign());

    expect(result.error).toMatch(/already been assigned/i);
    expect(stub.opsFor("shifts", "update")).toHaveLength(0);
  });

  it("stays quiet for a DRAFT shift, which staff cannot see", async () => {
    stub.on("shifts", "select", { data: openShift({ status: "draft" }) });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await assignOpenShift({}, assign());

    expect(notify).not.toHaveBeenCalled();
    expect(stub.opsFor("shift_acknowledgements")).toHaveLength(0);
  });

  it("tells the person when the shift is already PUBLISHED", async () => {
    stub.on("shifts", "select", { data: openShift({ status: "published" }) });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await assignOpenShift({}, assign());

    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0][0]).toMatchObject({
      userIds: [STAFF],
      deepLink: "/roster",
    });
    // And they are asked to confirm it.
    expect(stub.onlyOp("shift_acknowledgements", "upsert").payload).toMatchObject(
      { shift_id: SHIFT, user_id: STAFF, status: "pending" },
    );
  });

  it("refuses when the person has a blocking conflict", async () => {
    vi.mocked(getConflictContext).mockResolvedValueOnce({
      existingShifts: [
        {
          id: "other",
          userId: STAFF,
          propertyId: PROPERTY,
          startsAt: "2026-07-27T23:00:00.000Z",
          endsAt: "2026-07-28T07:00:00.000Z",
        },
      ],
      approvedLeave: [],
      availability: [],
      minimumRestHours: 10,
    });
    stub.on("shifts", "select", { data: openShift() });

    const result = await assignOpenShift({}, assign());

    expect(result.error).toMatch(/roster conflict/i);
    expect(result.conflicts?.length).toBeGreaterThan(0);
    expect(stub.opsFor("shifts", "update")).toHaveLength(0);
  });

  it("requires a staff member to be chosen", async () => {
    const result = await assignOpenShift({}, formData({ shiftId: SHIFT }));

    expect(result.fieldErrors?.userId).toBeTruthy();
    expect(stub.operations).toHaveLength(0);
  });
});

describe("publishRoster", () => {
  const publish = (over: Record<string, string> = {}) =>
    formData({
      weekStartDate: "2026-08-03",
      propertyId: PROPERTY,
      requireAck: "on",
      ...over,
    });

  const drafts = (rows: { id: string; user_id: string | null }[]) =>
    stub.on("shifts", "update", { data: rows });

  it("publishes only draft, unarchived shifts in that week and property", async () => {
    stub.on("roster_periods", "select", { data: null });
    stub.on("roster_periods", "insert", { data: { id: "period-1" } });
    drafts([{ id: "s1", user_id: STAFF }]);

    await publishRoster({}, publish());

    const update = stub.onlyOp("shifts", "update");
    expect(update.payload).toMatchObject({
      status: "published",
      published_by: MANAGER.id,
      roster_period_id: "period-1",
    });
    expect(hasFilter(update, "eq", "property_id", PROPERTY)).toBe(true);
    expect(hasFilter(update, "eq", "status", "draft")).toBe(true);
    expect(hasFilter(update, "is", "archived_at", null)).toBe(true);
  });

  it("bounds the week in the property timezone, not UTC", async () => {
    stub.on("roster_periods", "select", { data: null });
    stub.on("roster_periods", "insert", { data: { id: "period-1" } });
    drafts([{ id: "s1", user_id: STAFF }]);

    await publishRoster({}, publish());

    // Local midnight on Monday 3 August in Sydney is 14:00 UTC the Sunday.
    const update = stub.onlyOp("shifts", "update");
    expect(hasFilter(update, "gte", "starts_at", "2026-08-02T14:00:00.000Z")).toBe(
      true,
    );
    expect(hasFilter(update, "lt", "starts_at", "2026-08-09T14:00:00.000Z")).toBe(
      true,
    );
  });

  it("updates an existing roster period instead of inserting a second", async () => {
    stub.on("roster_periods", "select", { data: { id: "period-existing" } });
    stub.on("roster_periods", "update", { data: { id: "period-existing" } });
    drafts([{ id: "s1", user_id: STAFF }]);

    await publishRoster({}, publish());

    expect(stub.opsFor("roster_periods", "insert")).toHaveLength(0);
    expect(stub.onlyOp("roster_periods", "update").payload).toMatchObject({
      status: "published",
      published_by: MANAGER.id,
    });
  });

  it("asks only ASSIGNED shifts to be acknowledged", async () => {
    stub.on("roster_periods", "select", { data: null });
    stub.on("roster_periods", "insert", { data: { id: "period-1" } });
    drafts([
      { id: "s1", user_id: STAFF },
      { id: "s2", user_id: null }, // an open shift nobody holds
    ]);

    await publishRoster({}, publish());

    const upsert = stub.onlyOp("shift_acknowledgements", "upsert")
      .payload as { shift_id: string }[];
    expect(upsert).toHaveLength(1);
    expect(upsert[0].shift_id).toBe("s1");
  });

  it("creates no acknowledgements when they are not required", async () => {
    stub.on("roster_periods", "select", { data: null });
    stub.on("roster_periods", "insert", { data: { id: "period-1" } });
    drafts([{ id: "s1", user_id: STAFF }]);

    await publishRoster({}, publish({ requireAck: "off" }));

    expect(stub.opsFor("shift_acknowledgements")).toHaveLength(0);
  });

  it("sends one message per person, not one per shift", async () => {
    stub.on("roster_periods", "select", { data: null });
    stub.on("roster_periods", "insert", { data: { id: "period-1" } });
    drafts([
      { id: "s1", user_id: STAFF },
      { id: "s2", user_id: STAFF },
      { id: "s3", user_id: STAFF },
    ]);

    await publishRoster({}, publish());

    expect(notify).toHaveBeenCalledTimes(1);
    // Somebody with three new shifts wants one message, not three.
    expect(vi.mocked(notify).mock.calls[0][0].userIds).toEqual([STAFF]);
  });

  it("keeps times, names and pay out of the notification", async () => {
    stub.on("roster_periods", "select", { data: null });
    stub.on("roster_periods", "insert", { data: { id: "period-1" } });
    drafts([{ id: "s1", user_id: STAFF }]);

    await publishRoster({}, publish());

    // This can appear on a locked phone screen.
    const body = vi.mocked(notify).mock.calls[0][0].body;
    expect(body).toBe("Your roster for 3–9 August 2026 has been published.");
    expect(body).not.toMatch(/\d\s?(am|pm)/i);
    expect(body).not.toMatch(/\$/);
  });

  it("notifies nobody when only open shifts were published", async () => {
    stub.on("roster_periods", "select", { data: null });
    stub.on("roster_periods", "insert", { data: { id: "period-1" } });
    drafts([{ id: "s1", user_id: null }]);

    await publishRoster({}, publish());

    expect(notify).not.toHaveBeenCalled();
  });

  it("says so when there was nothing to publish", async () => {
    stub.on("roster_periods", "select", { data: null });
    stub.on("roster_periods", "insert", { data: { id: "period-1" } });
    drafts([]);

    const result = await publishRoster({}, publish());

    expect(result.success).toMatch(/no draft shifts/i);
    expect(notify).not.toHaveBeenCalled();
  });

  it("reports a publish that landed but could not be announced", async () => {
    stub.on("roster_periods", "select", { data: null });
    stub.on("roster_periods", "insert", { data: { id: "period-1" } });
    drafts([{ id: "s1", user_id: STAFF }]);
    vi.mocked(notify).mockResolvedValueOnce({
      recorded: 0,
      pushed: 0,
      pruned: 0,
      error: "push service unavailable",
    });

    const result = await publishRoster({}, publish());

    // The shifts ARE published; saying "failed" would be wrong, and saying
    // nothing would leave staff uninformed with nobody aware of it.
    expect(result.success).toMatch(/staff could not be notified/i);
    expect(result.error).toBeUndefined();
  });

  it("rejects a week that is not a date", async () => {
    const result = await publishRoster({}, publish({ weekStartDate: "soon" }));

    expect(result.error).toMatch(/invalid week/i);
    expect(stub.operations).toHaveLength(0);
  });
});

describe("clearRosterWeek", () => {
  const clear = (over: Record<string, string> = {}) =>
    formData({ weekStartDate: "2026-08-03", ...over });

  const cleared = (rows: { id: string; user_id: string | null; status: string }[]) =>
    stub.on("shifts", "update", { data: rows });

  it("requires an administrator, not a manager", async () => {
    cleared([]);
    await clearRosterWeek({}, clear());
    expect(requireRole).toHaveBeenCalledWith("administrator");
  });

  it("archives rather than deletes, so history survives", async () => {
    cleared([{ id: "s1", user_id: STAFF, status: "draft" }]);

    const result = await clearRosterWeek({}, clear());

    expect(stub.onlyOp("shifts", "update").payload).toMatchObject({
      archived_at: expect.any(String),
    });
    expect(stub.opsFor("shifts", "delete")).toHaveLength(0);
    expect(result.success).toMatch(/Cleared 1 shift\./);
  });

  it("bounds the week in the property timezone", async () => {
    cleared([]);

    await clearRosterWeek({}, clear());

    const update = stub.opsFor("shifts", "update")[0];
    expect(hasFilter(update, "gte", "starts_at", "2026-08-02T14:00:00.000Z")).toBe(
      true,
    );
    expect(hasFilter(update, "lt", "starts_at", "2026-08-09T14:00:00.000Z")).toBe(
      true,
    );
    expect(hasFilter(update, "is", "archived_at", null)).toBe(true);
  });

  it("leaves templates alone when archiving the roster period", async () => {
    cleared([]);

    await clearRosterWeek({}, clear());

    // A template has no week and must survive clearing one.
    const period = stub.onlyOp("roster_periods", "update");
    expect(hasFilter(period, "eq", "is_template", false)).toBe(true);
    expect(hasFilter(period, "eq", "week_start_date", "2026-08-03")).toBe(true);
  });

  it("narrows to one property when given one", async () => {
    cleared([]);

    await clearRosterWeek({}, clear({ propertyId: PROPERTY }));

    expect(
      hasFilter(stub.opsFor("shifts", "update")[0], "eq", "property_id", PROPERTY),
    ).toBe(true);
  });

  it("clears both properties when none is chosen", async () => {
    cleared([]);

    await clearRosterWeek({}, clear({ propertyId: "" }));

    const update = stub.opsFor("shifts", "update")[0];
    expect(update.filters.some((f) => f.args[0] === "property_id")).toBe(false);
  });

  it("tells anyone whose PUBLISHED shifts were taken away", async () => {
    cleared([
      { id: "s1", user_id: STAFF, status: "published" },
      { id: "s2", user_id: STAFF, status: "published" },
    ]);

    await clearRosterWeek({}, clear());

    // They arranged their week around it. Every other action that touches a
    // published shift says so; this used to be silent.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0][0].userIds).toEqual([STAFF]);
    expect(vi.mocked(notify).mock.calls[0][0].deepLink).toBe("/roster");
  });

  it("stays quiet when only drafts were cleared", async () => {
    cleared([{ id: "s1", user_id: STAFF, status: "draft" }]);

    await clearRosterWeek({}, clear());

    // Staff cannot see drafts, so clearing them is the tidy-up it appears
    // to be and needs no message.
    expect(notify).not.toHaveBeenCalled();
  });

  it("stays quiet about published shifts nobody held", async () => {
    cleared([{ id: "s1", user_id: null, status: "published" }]);

    await clearRosterWeek({}, clear());

    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps times and names out of the message", async () => {
    cleared([{ id: "s1", user_id: STAFF, status: "published" }]);

    await clearRosterWeek({}, clear());

    const body = vi.mocked(notify).mock.calls[0][0].body;
    expect(body).toContain("3–9 August 2026");
    expect(body).not.toMatch(/\d\s?(am|pm)/i);
  });

  it("reports a failure rather than claiming a clear week", async () => {
    stub.on("shifts", "update", { error: { message: "denied" } });

    const result = await clearRosterWeek({}, clear());

    expect(result.error).toMatch(/could not clear/i);
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects a week that is not a date", async () => {
    const result = await clearRosterWeek({}, clear({ weekStartDate: "later" }));

    expect(result.error).toMatch(/invalid week/i);
    expect(stub.operations).toHaveLength(0);
  });
});
