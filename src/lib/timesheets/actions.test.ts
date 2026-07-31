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

const { createManualTimesheet, updateTimesheetHours, resolveAdjustmentRequest } =
  await import("./actions");
const { notify } = await import("@/lib/notifications/deliver");

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
