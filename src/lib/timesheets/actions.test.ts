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

let stub: SupabaseStub;
beforeEach(() => {
  stub = createSupabaseStub();
  vi.clearAllMocks();
});

const {
  createManualTimesheet,
  updateTimesheetHours,
  resolveAdjustmentRequest,
  markPeriodExported,
  reopenExportedPeriod,
  approveTimesheets,
  generateTimesheets,
  acknowledgeTimesheet,
  requestCorrection,
} = await import("./actions");
const { notify } = await import("@/lib/notifications/deliver");
const { requireRole } = await import("@/lib/auth/session");

const SHEET = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const PROPERTY = "33333333-3333-4333-8333-333333333333";
const REQUEST = "44444444-4444-4444-8444-444444444444";

describe("createManualTimesheet", () => {
  const entry = (over: Record<string, string> = {}) =>
    formData({
      propertyId: PROPERTY,
      userId: STAFF,
      workDate: "2026-07-28",
      startTime: "09:00",
      endTime: "17:00",
      breakMinutes: "30",
      ...over,
    });

  it("records property-local times and the payable hours", async () => {
    stub.on("timesheets", "select", { data: null });

    const result = await createManualTimesheet({}, entry());

    expect(result.success).toMatch(/7\.5 h/);
    expect(stub.onlyOp("timesheets", "insert").payload).toMatchObject({
      user_id: STAFF,
      work_date: "2026-07-28",
      // 9am Sydney in July is 23:00 UTC the previous day.
      actual_start: "2026-07-27T23:00:00.000Z",
      actual_end: "2026-07-28T07:00:00.000Z",
      break_minutes: 30,
      paid_hours: 7.5,
      // No rostered window to compare against, so no variance to report.
      variance_hours: null,
      shift_id: null,
      status: "submitted",
    });
  });

  it("lands as submitted, so it joins the normal approval queue", async () => {
    stub.on("timesheets", "select", { data: null });
    await createManualTimesheet({}, entry());
    expect(stub.onlyOp("timesheets", "insert").payload).toMatchObject({
      status: "submitted",
    });
  });

  it("warns once before adding a second entry for the same person and day", async () => {
    stub.on("timesheets", "select", { data: { id: "existing" } });

    const result = await createManualTimesheet({}, entry());

    expect(result.needsConfirmation).toBe(true);
    expect(stub.opsFor("timesheets", "insert")).toHaveLength(0);
    // The entry is echoed back, so the confirmed save is the same one.
    expect(result.values).toMatchObject({ workDate: "2026-07-28" });
  });

  it("proceeds once the duplicate is confirmed", async () => {
    stub.on("timesheets", "select", { data: { id: "existing" } });

    const result = await createManualTimesheet(
      {},
      entry({ confirmDuplicate: "on" }),
    );

    expect(result.success).toBeTruthy();
    expect(stub.opsFor("timesheets", "insert")).toHaveLength(1);
  });

  it("reads a finish before the start as an overnight shift", async () => {
    stub.on("timesheets", "select", { data: null });

    await createManualTimesheet(
      {},
      entry({ startTime: "22:00", endTime: "06:00", breakMinutes: "0" }),
    );

    expect(stub.onlyOp("timesheets", "insert").payload).toMatchObject({
      paid_hours: 8,
      pay_period_end: "2026-07-29",
    });
  });

  it("refuses a break longer than the shift", async () => {
    const result = await createManualTimesheet(
      {},
      entry({ startTime: "09:00", endTime: "10:00", breakMinutes: "90" }),
    );

    expect(result.fieldErrors?.breakMinutes).toBeTruthy();
    expect(stub.opsFor("timesheets", "insert")).toHaveLength(0);
  });
});

describe("updateTimesheetHours", () => {
  const edit = (over: Record<string, string> = {}) =>
    formData({
      timesheetId: SHEET,
      startTime: "09:00",
      endTime: "17:00",
      breakMinutes: "30",
      ...over,
    });

  const sheet = (over: Record<string, unknown> = {}) => ({
    id: SHEET,
    user_id: STAFF,
    work_date: "2026-07-28",
    status: "submitted",
    locked_at: null,
    exported_at: null,
    rostered_start: null,
    rostered_end: null,
    ...over,
  });

  it("rewrites the hours against the timesheet's own work date", async () => {
    stub.on("timesheets", "select", { data: sheet() });
    stub.on("timesheets", "update", { data: { id: SHEET, user_id: STAFF } });

    const result = await updateTimesheetHours({}, edit());

    expect(result.success).toMatch(/7\.5 h/);
    expect(stub.onlyOp("timesheets", "update").payload).toMatchObject({
      actual_start: "2026-07-27T23:00:00.000Z",
      actual_end: "2026-07-28T07:00:00.000Z",
      paid_hours: 7.5,
      is_no_show: false,
    });
  });

  it("clears the approval when an approved timesheet is changed", async () => {
    stub.on("timesheets", "select", { data: sheet({ status: "approved" }) });
    stub.on("timesheets", "update", { data: { id: SHEET, user_id: STAFF } });

    const result = await updateTimesheetHours({}, edit());

    // An approval is a statement about particular figures.
    expect(stub.onlyOp("timesheets", "update").payload).toMatchObject({
      status: "manager_review",
      approved_by: null,
      approved_at: null,
    });
    expect(result.success).toMatch(/needs approving again/i);
  });

  it("leaves the status alone when it was not approved", async () => {
    stub.on("timesheets", "select", { data: sheet({ status: "submitted" }) });
    stub.on("timesheets", "update", { data: { id: SHEET, user_id: STAFF } });

    await updateTimesheetHours({}, edit());

    const payload = stub.onlyOp("timesheets", "update").payload as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("approved_by");
  });

  it("subtracts the planned unpaid break when computing variance", async () => {
    stub.on("timesheets", "select", {
      data: sheet({
        // Rostered 09:00-17:00 against a shift carrying a 30 minute unpaid
        // break, so the rostered figure is 7.5 h, not 8 h.
        rostered_start: "2026-07-27T23:00:00.000Z",
        rostered_end: "2026-07-28T07:00:00.000Z",
        shift_id: "shift-1",
      }),
    });
    stub.on("shift_breaks", "select", {
      data: [{ duration_minutes: 30, is_paid: false }],
    });
    stub.on("timesheets", "update", { data: { id: SHEET, user_id: STAFF } });

    await updateTimesheetHours({}, edit());

    // Worked 7.5 h against 7.5 h rostered. Comparing against the full
    // rostered span would report a phantom half-hour shortfall.
    expect(stub.onlyOp("timesheets", "update").payload).toMatchObject({
      variance_hours: 0,
    });
  });

  it("ignores PAID breaks, which are part of the rostered hours", async () => {
    stub.on("timesheets", "select", {
      data: sheet({
        rostered_start: "2026-07-27T23:00:00.000Z",
        rostered_end: "2026-07-28T07:00:00.000Z",
        shift_id: "shift-1",
      }),
    });
    stub.on("shift_breaks", "select", {
      data: [{ duration_minutes: 30, is_paid: true }],
    });
    stub.on("timesheets", "update", { data: { id: SHEET, user_id: STAFF } });

    await updateTimesheetHours({}, edit());

    // Rostered stays 8 h, worked is 7.5 h, so half an hour short.
    expect(stub.onlyOp("timesheets", "update").payload).toMatchObject({
      variance_hours: -0.5,
    });
  });

  it("reports no variance when there is no rostered window to compare", async () => {
    stub.on("timesheets", "select", { data: sheet() });
    stub.on("timesheets", "update", { data: { id: SHEET, user_id: STAFF } });

    await updateTimesheetHours({}, edit());

    // Null is honest; zero would read as "matched the roster".
    expect(stub.onlyOp("timesheets", "update").payload).toMatchObject({
      variance_hours: null,
    });
  });

  it("refuses a locked timesheet", async () => {
    stub.on("timesheets", "select", {
      data: sheet({ locked_at: "2026-07-30T00:00:00.000Z" }),
    });

    const result = await updateTimesheetHours({}, edit());

    expect(result.error).toMatch(/locked/i);
    expect(stub.opsFor("timesheets", "update")).toHaveLength(0);
  });

  it("refuses one already sent to payroll", async () => {
    stub.on("timesheets", "select", {
      data: sheet({ exported_at: "2026-07-30T00:00:00.000Z" }),
    });

    const result = await updateTimesheetHours({}, edit());

    expect(result.error).toMatch(/payroll/i);
    expect(stub.opsFor("timesheets", "update")).toHaveLength(0);
  });

  it("tells the staff member, because their pay changed", async () => {
    stub.on("timesheets", "select", { data: sheet() });
    stub.on("timesheets", "update", { data: { id: SHEET, user_id: STAFF } });

    await updateTimesheetHours({}, edit());

    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0][0]).toMatchObject({
      userIds: [STAFF],
      deepLink: "/timesheets",
    });
  });

  it("rejects a break longer than the shift without writing", async () => {
    stub.on("timesheets", "select", { data: sheet() });

    const result = await updateTimesheetHours(
      {},
      edit({ startTime: "09:00", endTime: "10:00", breakMinutes: "90" }),
    );

    expect(result.fieldErrors?.breakMinutes).toBeTruthy();
    expect(stub.opsFor("timesheets", "update")).toHaveLength(0);
  });
});

describe("resolveAdjustmentRequest", () => {
  const request = (over: Record<string, unknown> = {}) => ({
    id: REQUEST,
    timesheet_id: SHEET,
    user_id: STAFF,
    status: "open",
    requested_start: "2026-07-27T22:00:00.000Z",
    requested_end: "2026-07-28T07:00:00.000Z",
    requested_break_minutes: 30,
    ...over,
  });

  it("applies the requested figures rather than only agreeing with them", async () => {
    stub.on("timesheet_adjustment_requests", "select", { data: request() });
    stub.on("timesheets", "select", {
      data: {
        id: SHEET,
        break_minutes: 30,
        locked_at: null,
        exported_at: null,
        status: "approved",
        work_date: "2026-07-28",
      },
    });

    const result = await resolveAdjustmentRequest(
      {},
      formData({ requestId: REQUEST, decision: "approved" }),
    );

    // 22:00Z to 07:00Z is 9 hours, less a 30 minute break.
    expect(stub.onlyOp("timesheets", "update").payload).toMatchObject({
      actual_start: "2026-07-27T22:00:00.000Z",
      actual_end: "2026-07-28T07:00:00.000Z",
      paid_hours: 8.5,
      status: "manager_review",
      approved_by: null,
    });
    expect(result.success).toMatch(/applied/i);
  });

  it("closes the request and records who decided it", async () => {
    stub.on("timesheet_adjustment_requests", "select", { data: request() });
    stub.on("timesheets", "select", {
      data: { id: SHEET, break_minutes: 30, locked_at: null, exported_at: null },
    });

    await resolveAdjustmentRequest(
      {},
      formData({ requestId: REQUEST, decision: "approved" }),
    );

    const close = stub.onlyOp("timesheet_adjustment_requests", "update");
    expect(close.payload).toMatchObject({
      status: "approved",
      reviewed_by: MANAGER.id,
    });
    // Guarded so two managers cannot both resolve the same request.
    expect(hasFilter(close, "eq", "status", "open")).toBe(true);
  });

  it("declines without touching the hours", async () => {
    stub.on("timesheet_adjustment_requests", "select", { data: request() });

    const result = await resolveAdjustmentRequest(
      {},
      formData({
        requestId: REQUEST,
        decision: "declined",
        managerNote: "Roster shows the later finish.",
      }),
    );

    // The reply IS mirrored onto the timesheet — staff never see the request
    // rows, so a decline would otherwise be answered into a void. But it must
    // carry the note and nothing else: declining changes no pay.
    const mirror = stub.onlyOp("timesheets", "update");
    expect(mirror.payload).toEqual({
      manager_note: "Roster shows the later finish.",
    });

    expect(
      stub.onlyOp("timesheet_adjustment_requests", "update").payload,
    ).toMatchObject({
      status: "declined",
      manager_note: "Roster shows the later finish.",
    });
    expect(result.success).toMatch(/declined/i);
  });

  it("writes nothing to the timesheet when declining without a note", async () => {
    stub.on("timesheet_adjustment_requests", "select", { data: request() });

    await resolveAdjustmentRequest(
      {},
      formData({ requestId: REQUEST, decision: "declined" }),
    );

    expect(stub.opsFor("timesheets", "update")).toHaveLength(0);
  });

  it("answers the staff member either way", async () => {
    stub.on("timesheet_adjustment_requests", "select", { data: request() });

    await resolveAdjustmentRequest(
      {},
      formData({ requestId: REQUEST, decision: "declined" }),
    );

    // A request that vanished without a reply is the dead end this fixed.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0][0]).toMatchObject({
      userIds: [STAFF],
    });
  });

  it("refuses one that has already been dealt with", async () => {
    stub.on("timesheet_adjustment_requests", "select", {
      data: request({ status: "approved" }),
    });

    const result = await resolveAdjustmentRequest(
      {},
      formData({ requestId: REQUEST, decision: "approved" }),
    );

    expect(result.error).toMatch(/already been dealt with/i);
    expect(stub.opsFor("timesheets", "update")).toHaveLength(0);
  });

  it("will not apply to a timesheet already sent to payroll", async () => {
    stub.on("timesheet_adjustment_requests", "select", { data: request() });
    stub.on("timesheets", "select", {
      data: {
        id: SHEET,
        break_minutes: 30,
        locked_at: null,
        exported_at: "2026-07-30T00:00:00.000Z",
      },
    });

    const result = await resolveAdjustmentRequest(
      {},
      formData({ requestId: REQUEST, decision: "approved" }),
    );

    expect(result.error).toMatch(/payroll/i);
    expect(stub.opsFor("timesheets", "update")).toHaveLength(0);
  });

  it("asks for a manual edit when the request has no times", async () => {
    stub.on("timesheet_adjustment_requests", "select", {
      data: request({ requested_start: null, requested_end: null }),
    });
    stub.on("timesheets", "select", {
      data: { id: SHEET, break_minutes: 30, locked_at: null, exported_at: null },
    });

    const result = await resolveAdjustmentRequest(
      {},
      formData({ requestId: REQUEST, decision: "approved" }),
    );

    expect(result.error).toMatch(/both a start and a finish/i);
    expect(stub.opsFor("timesheets", "update")).toHaveLength(0);
  });
});

describe("markPeriodExported", () => {
  const period = (over: Record<string, string> = {}) =>
    formData({ fromDate: "2026-07-13", toDate: "2026-07-26", ...over });

  /** Queue the two head-count queries, then the update. */
  const counts = (ready: number, pending: number) => {
    stub.on("timesheets", "select", { count: ready, data: [] });
    stub.on("timesheets", "select", { count: pending, data: [] });
  };

  it("confirms before it runs, saying what it will do", async () => {
    counts(12, 0);

    const result = await markPeriodExported({}, period());

    expect(result.needsConfirmation).toBe(true);
    expect(result.error).toMatch(/12 approved timesheets/i);
    // Nothing written until confirmed.
    expect(stub.opsFor("timesheets", "update")).toHaveLength(0);
  });

  it("warns that unapproved timesheets will be left out", async () => {
    counts(10, 3);

    const result = await markPeriodExported({}, period());

    // Silently leaving hours behind is an underpayment found on payday.
    expect(result.error).toMatch(/3 timesheets.*still awaiting a decision/i);
    expect(result.error).toMatch(/will NOT be included/i);
  });

  it("marks only approved, unexported rows once confirmed", async () => {
    counts(2, 0);
    stub.on("timesheets", "update", { data: [{ id: "a" }, { id: "b" }] });

    const result = await markPeriodExported({}, period({ confirm: "on" }));

    const update = stub.onlyOp("timesheets", "update");
    expect(update.payload).toMatchObject({
      status: "exported",
      exported_at: expect.any(String),
    });
    // Repeated in the write, so a row edited between count and write is safe.
    expect(hasFilter(update, "eq", "status", "approved")).toBe(true);
    expect(hasFilter(update, "is", "exported_at", null)).toBe(true);
    expect(result.success).toMatch(/Marked 2 timesheets/i);
  });

  it("scopes the write to the period and property", async () => {
    counts(1, 0);
    stub.on("timesheets", "update", { data: [{ id: "a" }] });

    await markPeriodExported(
      {},
      period({ confirm: "on", propertyId: PROPERTY }),
    );

    const update = stub.onlyOp("timesheets", "update");
    expect(hasFilter(update, "gte", "work_date", "2026-07-13")).toBe(true);
    expect(hasFilter(update, "lte", "work_date", "2026-07-26")).toBe(true);
    expect(hasFilter(update, "eq", "property_id", PROPERTY)).toBe(true);
  });

  it("says so when nothing is approved yet", async () => {
    counts(0, 5);

    const result = await markPeriodExported({}, period());

    expect(result.error).toMatch(/Nothing in that period is approved yet/i);
    expect(result.needsConfirmation).toBeUndefined();
    expect(stub.opsFor("timesheets", "update")).toHaveLength(0);
  });

  it("says so when the period is empty", async () => {
    counts(0, 0);

    const result = await markPeriodExported({}, period());

    expect(result.error).toMatch(/no approved timesheets/i);
  });

  it("reports how many were left behind after marking", async () => {
    counts(4, 2);
    stub.on("timesheets", "update", {
      data: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    });

    const result = await markPeriodExported({}, period({ confirm: "on" }));

    expect(result.success).toMatch(/Marked 4 timesheets/i);
    expect(result.success).toMatch(/2 still awaiting a decision were left out/i);
  });

  it("rejects a backwards range", async () => {
    const result = await markPeriodExported(
      {},
      period({ fromDate: "2026-07-26", toDate: "2026-07-13" }),
    );

    expect(result.error).toMatch(/cannot be before/i);
    expect(stub.operations).toHaveLength(0);
  });
});

describe("reopenExportedPeriod", () => {
  const period = (over: Record<string, string> = {}) =>
    formData({ fromDate: "2026-07-13", toDate: "2026-07-26", ...over });

  it("is the exact inverse of marking as exported", async () => {
    stub.on("timesheets", "update", { data: [{ id: "a" }] });

    const result = await reopenExportedPeriod({}, period());

    const update = stub.onlyOp("timesheets", "update");
    // Back to approved with the export cleared; the approval itself stands.
    expect(update.payload).toEqual({ status: "approved", exported_at: null });
    expect(hasFilter(update, "eq", "status", "exported")).toBe(true);
    expect(result.success).toMatch(/Reopened 1 timesheet/i);
  });

  it("leaves locked timesheets alone", async () => {
    stub.on("timesheets", "update", { data: [{ id: "a" }] });

    await reopenExportedPeriod({}, period());

    // Locking is a further step and is not undone here.
    expect(hasFilter(stub.onlyOp("timesheets", "update"), "is", "locked_at", null)).toBe(
      true,
    );
  });

  it("requires an administrator, not just a manager", async () => {
    stub.on("timesheets", "update", { data: [{ id: "a" }] });

    await reopenExportedPeriod({}, period());

    expect(requireRole).toHaveBeenCalledWith("administrator");
  });

  it("says so when there is nothing to reopen", async () => {
    stub.on("timesheets", "update", { data: [] });

    const result = await reopenExportedPeriod({}, period());

    expect(result.error).toMatch(/nothing in that period is marked as sent/i);
  });
});

describe("approveTimesheets", () => {
  const ids = [SHEET, "55555555-5555-4555-8555-555555555555"];

  it("approves the selected timesheets and stamps the approver", async () => {
    stub.on("timesheets", "update", {
      data: [
        { id: ids[0], user_id: STAFF, organisation_id: "org-1" },
        { id: ids[1], user_id: STAFF, organisation_id: "org-1" },
      ],
    });

    const result = await approveTimesheets({}, formData({ ids }));

    const update = stub.onlyOp("timesheets", "update");
    expect(update.payload).toMatchObject({
      status: "approved",
      approved_by: MANAGER.id,
      approved_at: expect.any(String),
    });
    expect(hasFilter(update, "in", "id", ids)).toBe(true);
    expect(result.success).toMatch(/Approved 2 timesheets/i);
  });

  it("does NOT erase an existing manager note when no note is typed", async () => {
    stub.on("timesheets", "update", {
      data: [{ id: ids[0], user_id: STAFF, organisation_id: "org-1" }],
    });

    await approveTimesheets({}, formData({ ids: [ids[0]] }));

    // Sending manager_note: null on a bulk approval wiped the reply a
    // manager had written when declining a correction request — which is
    // the only way the staff member ever sees that answer.
    const payload = stub.onlyOp("timesheets", "update").payload as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty("manager_note");
  });

  it("writes the note when one is given", async () => {
    stub.on("timesheets", "update", {
      data: [{ id: ids[0], user_id: STAFF, organisation_id: "org-1" }],
    });

    await approveTimesheets(
      {},
      formData({ ids: [ids[0]], managerNote: "Checked against the roster." }),
    );

    expect(stub.onlyOp("timesheets", "update").payload).toMatchObject({
      manager_note: "Checked against the roster.",
    });
  });

  it("tells each affected person once, not once per timesheet", async () => {
    stub.on("timesheets", "update", {
      data: [
        { id: ids[0], user_id: STAFF, organisation_id: "org-1" },
        { id: ids[1], user_id: STAFF, organisation_id: "org-1" },
      ],
    });

    await approveTimesheets({}, formData({ ids }));

    expect(notify).toHaveBeenCalledTimes(1);
    // notify() de-duplicates the recipient list itself.
    expect(vi.mocked(notify).mock.calls[0][0].userIds).toEqual([STAFF, STAFF]);
  });

  it("refuses an empty selection without touching the database", async () => {
    const result = await approveTimesheets({}, formData({ ids: [] }));

    expect(result.error).toMatch(/select at least one/i);
    expect(stub.operations).toHaveLength(0);
  });

  it("surfaces a database guard, such as approving your own", async () => {
    stub.on("timesheets", "update", {
      error: { message: "You may not approve your own timesheet." },
    });

    const result = await approveTimesheets({}, formData({ ids: [ids[0]] }));

    // The guards raise rather than matching zero rows, so the real reason
    // is worth showing rather than a generic failure.
    expect(result.error).toBe("You may not approve your own timesheet.");
    expect(notify).not.toHaveBeenCalled();
  });

  it("reports when nothing matched", async () => {
    stub.on("timesheets", "update", { data: [] });

    const result = await approveTimesheets({}, formData({ ids: [ids[0]] }));

    expect(result.error).toMatch(/none of those timesheets/i);
    expect(notify).not.toHaveBeenCalled();
  });

  it("ignores a non-uuid id rather than sending it to the database", async () => {
    const result = await approveTimesheets({}, formData({ ids: ["nope"] }));

    expect(result.error).toMatch(/select at least one/i);
    expect(stub.operations).toHaveLength(0);
  });
});

describe("generateTimesheets", () => {
  const build = (over: Record<string, string> = {}) =>
    formData({
      propertyId: PROPERTY,
      fromDate: "2026-07-13",
      toDate: "2026-07-26",
      ...over,
    });

  /** Queue the three reads the action makes, in table order. */
  const reads = (opts: {
    events?: unknown[];
    shifts?: unknown[];
    existing?: unknown[];
  }) => {
    stub.on("clock_events", "select", { data: opts.events ?? [] });
    stub.on("shifts", "select", { data: opts.shifts ?? [] });
    stub.on("timesheets", "select", { data: opts.existing ?? [] });
  };

  const clockIn = (serverTime: string) => ({
    id: `in-${serverTime}`,
    user_id: STAFF,
    event_type: "clock_in",
    server_time: serverTime,
    shift_id: null,
  });
  const clockOut = (serverTime: string) => ({
    id: `out-${serverTime}`,
    user_id: STAFF,
    event_type: "clock_out",
    server_time: serverTime,
    shift_id: null,
  });

  it("reads a half-open window at LOCAL midnight, correct under AEDT", async () => {
    reads({});

    await generateTimesheets(
      {},
      build({ fromDate: "2026-01-20", toDate: "2026-01-21" }),
    );

    // January is AEDT (+11), so local midnight on the 20th is 13:00 UTC on
    // the 19th. A hardcoded +10:00 put this an hour out for half the year,
    // losing the first hour of clock events and sweeping in an hour of the
    // following day.
    const events = stub.opsFor("clock_events", "select")[0];
    expect(hasFilter(events, "gte", "server_time", "2026-01-19T13:00:00.000Z")).toBe(
      true,
    );
    expect(hasFilter(events, "lt", "server_time", "2026-01-21T13:00:00.000Z")).toBe(
      true,
    );
  });

  it("uses AEST correctly in winter", async () => {
    reads({});
    await generateTimesheets({}, build({ fromDate: "2026-07-13", toDate: "2026-07-13" }));

    const events = stub.opsFor("clock_events", "select")[0];
    expect(hasFilter(events, "gte", "server_time", "2026-07-12T14:00:00.000Z")).toBe(
      true,
    );
    expect(hasFilter(events, "lt", "server_time", "2026-07-13T14:00:00.000Z")).toBe(
      true,
    );
  });

  it("builds a timesheet from a day's clock events", async () => {
    reads({
      // 9am to 5pm Sydney on 13 July.
      events: [
        clockIn("2026-07-12T23:00:00.000Z"),
        clockOut("2026-07-13T07:00:00.000Z"),
      ],
    });

    const result = await generateTimesheets({}, build());

    const rows = stub.onlyOp("timesheets", "insert").payload as Record<
      string,
      unknown
    >[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: STAFF,
      work_date: "2026-07-13",
      property_id: PROPERTY,
      status: "submitted",
      pay_period_start: "2026-07-13",
      pay_period_end: "2026-07-26",
      is_no_show: false,
    });
    expect(result.success).toMatch(/Built 1 timesheet/i);
  });

  /** A timesheet row as the existing-rows read returns it. */
  const existingSheet = (over: Record<string, unknown> = {}) => ({
    id: "ts-1",
    user_id: STAFF,
    work_date: "2026-07-13",
    status: "submitted",
    manager_note: null,
    staff_acknowledged_at: null,
    actual_start: null,
    actual_end: null,
    ...over,
  });

  it("never rebuilds a timesheet a manager has annotated", async () => {
    reads({
      events: [
        clockIn("2026-07-12T23:00:00.000Z"),
        clockOut("2026-07-13T07:00:00.000Z"),
      ],
      existing: [existingSheet({ manager_note: "Agreed 30 min unpaid." })],
    });

    const result = await generateTimesheets({}, build());

    // Rebuilding would silently discard the correction.
    expect(stub.opsFor("timesheets", "insert")).toHaveLength(0);
    expect(stub.opsFor("timesheets", "update")).toHaveLength(0);
    expect(result.success).toMatch(/nothing to do/i);
  });

  it("never rebuilds one the staff member has acknowledged", async () => {
    reads({
      events: [clockIn("2026-07-12T23:00:00.000Z")],
      existing: [existingSheet({ staff_acknowledged_at: "2026-07-13T09:00:00Z" })],
    });

    await generateTimesheets({}, build());

    expect(stub.opsFor("timesheets", "update")).toHaveLength(0);
  });

  it("never rebuilds one that has left review", async () => {
    reads({
      events: [clockIn("2026-07-12T23:00:00.000Z")],
      existing: [existingSheet({ status: "approved" })],
    });

    await generateTimesheets({}, build());

    expect(stub.opsFor("timesheets", "update")).toHaveLength(0);
  });

  it("never rebuilds a hand-entered sheet, which always carries both times", async () => {
    reads({
      events: [clockIn("2026-07-12T23:00:00.000Z")],
      existing: [
        existingSheet({
          actual_start: "2026-07-12T23:00:00Z",
          actual_end: "2026-07-13T07:00:00Z",
        }),
      ],
    });

    await generateTimesheets({}, build());

    expect(stub.opsFor("timesheets", "update")).toHaveLength(0);
  });

  it("DOES rebuild an untouched sheet that has no attendance on it", async () => {
    // The bug this fixes. A range generated before the shift happened wrote
    // a no-show for every rostered day, and skipping every existing row meant
    // the real clock-in could never reach it — the day was frozen as "did not
    // turn up" before it began, and the person would be paid nothing.
    reads({
      events: [
        clockIn("2026-07-12T23:00:00.000Z"),
        clockOut("2026-07-13T07:00:00.000Z"),
      ],
      existing: [existingSheet()],
    });
    stub.on("timesheets", "update", { data: { id: "ts-1" }, error: null });

    const result = await generateTimesheets({}, build());

    const update = stub.onlyOp("timesheets", "update");
    const patch = update.payload as Record<string, unknown>;
    expect(patch.actual_start).toBe("2026-07-12T23:00:00.000Z");
    expect(patch.actual_end).toBe("2026-07-13T07:00:00.000Z");
    expect(patch.is_no_show).toBe(false);
    expect(hasFilter(update, "eq", "id", "ts-1")).toBe(true);
    expect(stub.opsFor("timesheets", "insert")).toHaveLength(0);
    expect(result.success).toMatch(/updated 1/i);
  });

  it("finishes a sheet built mid-shift, once the clock-out arrives", async () => {
    reads({
      events: [
        clockIn("2026-07-12T23:00:00.000Z"),
        clockOut("2026-07-13T07:00:00.000Z"),
      ],
      existing: [existingSheet({ actual_start: "2026-07-12T23:00:00Z" })],
    });
    stub.on("timesheets", "update", { data: { id: "ts-1" }, error: null });

    await generateTimesheets({}, build());

    const patch = stub.onlyOp("timesheets", "update").payload as Record<
      string,
      unknown
    >;
    expect(patch.actual_end).toBe("2026-07-13T07:00:00.000Z");
  });

  it("re-checks the row is untouched at the moment it writes", async () => {
    // Between reading the row and updating it, a manager may have approved
    // the very sheet being rebuilt.
    reads({
      events: [clockIn("2026-07-12T23:00:00.000Z")],
      existing: [existingSheet()],
    });
    stub.on("timesheets", "update", { data: { id: "ts-1" }, error: null });

    await generateTimesheets({}, build());

    const update = stub.onlyOp("timesheets", "update");
    expect(hasFilter(update, "eq", "status", "submitted")).toBe(true);
    expect(hasFilter(update, "is", "manager_note", null)).toBe(true);
    expect(hasFilter(update, "is", "staff_acknowledged_at", null)).toBe(true);
  });

  it("does not move a rebuilt sheet backwards through review", async () => {
    reads({
      events: [clockIn("2026-07-12T23:00:00.000Z")],
      existing: [existingSheet()],
    });
    stub.on("timesheets", "update", { data: { id: "ts-1" }, error: null });

    await generateTimesheets({}, build());

    const patch = stub.onlyOp("timesheets", "update").payload as Record<
      string,
      unknown
    >;
    expect(patch.status).toBeUndefined();
    expect(patch.created_by).toBeUndefined();
  });

  it("records a rostered no-show, so an absence is not invisible", async () => {
    reads({
      events: [],
      shifts: [
        {
          id: "shift-1",
          user_id: STAFF,
          starts_at: "2026-07-12T23:00:00.000Z",
          ends_at: "2026-07-13T07:00:00.000Z",
          shift_breaks: [],
        },
      ],
    });

    await generateTimesheets({}, build());

    const rows = stub.onlyOp("timesheets", "insert").payload as Record<
      string,
      unknown
    >[];
    expect(rows[0]).toMatchObject({
      work_date: "2026-07-13",
      is_no_show: true,
      shift_id: "shift-1",
    });
  });

  it("ignores an unassigned shift, which nobody can fail to turn up to", async () => {
    reads({
      shifts: [
        {
          id: "open-1",
          user_id: null,
          starts_at: "2026-07-12T23:00:00.000Z",
          ends_at: "2026-07-13T07:00:00.000Z",
          shift_breaks: [],
        },
      ],
    });

    const result = await generateTimesheets({}, build());

    expect(stub.opsFor("timesheets", "insert")).toHaveLength(0);
    expect(result.success).toMatch(/nothing to do/i);
  });

  it("refuses a range that has not happened yet", async () => {
    // A shift with no attendance is written as a no-show, and that is what
    // froze real clock-ins out.
    const result = await generateTimesheets(
      {},
      build({ fromDate: "2099-01-01", toDate: "2099-01-07" }),
    );

    expect(result.error).toMatch(/has not happened yet/i);
    expect(stub.operations).toHaveLength(0);
  });

  it("stops a range at today rather than refusing it", async () => {
    // Picking the current week on a Wednesday is the normal thing to do.
    reads({});

    const result = await generateTimesheets(
      {},
      build({ fromDate: "2026-07-13", toDate: "2099-01-07" }),
    );

    const existing = stub.onlyOp("timesheets", "select");
    const upper = existing.filters.find((f) => f.method === "lte");
    expect(String(upper?.args[1])).not.toBe("2099-01-07");
    expect(result.success).toMatch(/stopped at today/i);
  });

  it("counts only UNPAID breaks against the rostered hours", async () => {
    reads({
      events: [
        clockIn("2026-07-12T23:00:00.000Z"),
        clockOut("2026-07-13T07:00:00.000Z"),
      ],
      shifts: [
        {
          id: "shift-1",
          user_id: STAFF,
          starts_at: "2026-07-12T23:00:00.000Z",
          ends_at: "2026-07-13T07:00:00.000Z",
          shift_breaks: [
            { duration_minutes: 30, is_paid: false },
            { duration_minutes: 15, is_paid: true },
          ],
        },
      ],
    });

    await generateTimesheets({}, build());

    // Rostered 8h less the 30 unpaid minutes = 7.5h; worked 8h, so half an
    // hour over. Counting the paid break too would report an hour and a
    // quarter of unrostered overtime that nobody worked.
    const rows = stub.onlyOp("timesheets", "insert").payload as Record<
      string,
      unknown
    >[];
    expect(rows[0].variance_hours).toBe(0.5);
  });

  it("stops rather than duplicating when the existing-sheet check fails", async () => {
    stub.on("clock_events", "select", { data: [] });
    stub.on("shifts", "select", { data: [] });
    stub.on("timesheets", "select", {
      error: { message: "statement timeout" },
    });

    const result = await generateTimesheets({}, build());

    // An unchecked failure here left `alreadyThere` empty and re-inserted
    // every day in the range, duplicating corrected timesheets.
    expect(result.error).toMatch(/existing timesheets.*statement timeout/i);
    expect(stub.opsFor("timesheets", "insert")).toHaveLength(0);
  });

  it("stops rather than losing no-shows when the roster read fails", async () => {
    stub.on("clock_events", "select", { data: [] });
    stub.on("shifts", "select", { error: { message: "statement timeout" } });
    stub.on("timesheets", "select", { data: [] });

    const result = await generateTimesheets({}, build());

    expect(result.error).toMatch(/the roster.*statement timeout/i);
    expect(stub.opsFor("timesheets", "insert")).toHaveLength(0);
  });

  it("stops when attendance cannot be read", async () => {
    stub.on("clock_events", "select", { error: { message: "boom" } });
    stub.on("shifts", "select", { data: [] });
    stub.on("timesheets", "select", { data: [] });

    const result = await generateTimesheets({}, build());

    expect(result.error).toMatch(/attendance.*boom/i);
  });

  it("rejects a backwards range", async () => {
    const result = await generateTimesheets(
      {},
      build({ fromDate: "2026-07-26", toDate: "2026-07-13" }),
    );

    expect(result.error).toMatch(/cannot be before/i);
    expect(stub.operations).toHaveLength(0);
  });
});

describe("acknowledgeTimesheet", () => {
  const ack = (over: Record<string, string> = {}) =>
    formData({ id: SHEET, ...over });

  it("records that the person checked their hours", async () => {
    await acknowledgeTimesheet({}, ack());

    expect(stub.onlyOp("timesheets", "update").payload).toMatchObject({
      staff_acknowledged_at: expect.any(String),
    });
  });

  it("can only acknowledge your OWN timesheet", async () => {
    await acknowledgeTimesheet({}, ack());

    // `timesheets_write_manager` is a `for all` policy, so RLS alone would
    // let a manager set this on somebody else's row. The column is evidence
    // that the staff member checked their own hours — a manager able to
    // stamp it is the one thing it must not allow.
    const update = stub.onlyOp("timesheets", "update");
    expect(hasFilter(update, "eq", "id", SHEET)).toBe(true);
    expect(hasFilter(update, "eq", "user_id", MANAGER.id)).toBe(true);
  });

  it("does NOT erase an existing note when confirming without one", async () => {
    await acknowledgeTimesheet({}, ack());

    // The confirm button sends no note field, so `note ?? null` cleared it
    // on every single acknowledgement.
    const payload = stub.onlyOp("timesheets", "update").payload as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty("staff_note");
  });

  it("writes a note when one is given", async () => {
    await acknowledgeTimesheet({}, ack({ note: "Finished 20 minutes late." }));

    expect(stub.onlyOp("timesheets", "update").payload).toMatchObject({
      staff_note: "Finished 20 minutes late.",
    });
  });

  it("never touches the hours", async () => {
    await acknowledgeTimesheet({}, ack({ note: "ok" }));

    // `guard_timesheet_staff_update` permits staff exactly two columns, but
    // the action should not be trying for more either.
    const payload = stub.onlyOp("timesheets", "update").payload as Record<
      string,
      unknown
    >;
    for (const field of ["paid_hours", "actual_start", "actual_end", "status"]) {
      expect(payload).not.toHaveProperty(field);
    }
  });

  it("rejects an id that is not a uuid", async () => {
    const result = await acknowledgeTimesheet({}, ack({ id: "nope" }));
    expect(result.error).toMatch(/could not be identified/i);
    expect(stub.operations).toHaveLength(0);
  });
});

describe("requestCorrection", () => {
  const correct = (over: Record<string, string> = {}) =>
    formData({
      timesheetId: SHEET,
      explanation: "I finished at five, not three.",
      ...over,
    });

  const sheetOn = (workDate = "2026-07-28") =>
    stub.on("timesheets", "select", {
      data: { id: SHEET, work_date: workDate, status: "submitted" },
    });

  it("anchors requested times to the timesheet's own date, in property time", async () => {
    sheetOn("2026-07-28");

    await requestCorrection(
      {},
      correct({ requestedStart: "09:00", requestedEnd: "17:00" }),
    );

    // These columns are timestamptz. Handing Postgres a bare "09:00" stamped
    // it onto TODAY in the session timezone, so a correction for last
    // Tuesday was stored against this morning.
    expect(stub.onlyOp("timesheet_adjustment_requests", "insert").payload)
      .toMatchObject({
        requested_date: "2026-07-28",
        requested_start: "2026-07-27T23:00:00.000Z",
        requested_end: "2026-07-28T07:00:00.000Z",
      });
  });

  it("reads a finish before the start as an overnight shift", async () => {
    sheetOn("2026-07-28");

    await requestCorrection(
      {},
      correct({ requestedStart: "22:00", requestedEnd: "06:00" }),
    );

    expect(stub.onlyOp("timesheet_adjustment_requests", "insert").payload)
      .toMatchObject({
        requested_start: "2026-07-28T12:00:00.000Z",
        requested_end: "2026-07-28T20:00:00.000Z",
      });
  });

  it("arrives open, for a manager to act on", async () => {
    sheetOn();

    await requestCorrection({}, correct());

    expect(stub.onlyOp("timesheet_adjustment_requests", "insert").payload)
      .toMatchObject({ status: "open", user_id: MANAGER.id });
  });

  it("leaves the recorded hours exactly as they are", async () => {
    sheetOn();

    await requestCorrection(
      {},
      correct({ requestedStart: "09:00", requestedEnd: "17:00" }),
    );

    // A correction is a REQUEST. Attendance is append-only and staff cannot
    // change their own hours.
    expect(stub.opsFor("timesheets", "update")).toHaveLength(0);
  });

  it("rejects a malformed start time with a readable message", async () => {
    const result = await requestCorrection(
      {},
      correct({ requestedStart: "9am", requestedEnd: "17:00" }),
    );

    // Unvalidated, this reached localDateTimeToIso, which throws — and the
    // outer catch reported "Cannot reach StayFlow right now", sending
    // somebody to check their signal over a typo.
    expect(result.error).toMatch(/start time as hh:mm/i);
    expect(stub.opsFor("timesheet_adjustment_requests", "insert")).toHaveLength(0);
  });

  it("rejects a malformed finish time too", async () => {
    const result = await requestCorrection(
      {},
      correct({ requestedStart: "09:00", requestedEnd: "5pm" }),
    );
    expect(result.error).toMatch(/finish time as hh:mm/i);
  });

  it("insists on an explanation a manager can act on", async () => {
    const result = await requestCorrection({}, correct({ explanation: "wrong" }));
    expect(result.error).toMatch(/explain what was wrong/i);
    expect(stub.operations).toHaveLength(0);
  });

  it("reports a timesheet that has gone", async () => {
    stub.on("timesheets", "select", { data: null });

    const result = await requestCorrection({}, correct());

    expect(result.error).toMatch(/no longer available/i);
    expect(stub.opsFor("timesheet_adjustment_requests", "insert")).toHaveLength(0);
  });
});
