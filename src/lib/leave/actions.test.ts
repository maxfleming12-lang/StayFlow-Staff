import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANAGER,
  createSupabaseStub,
  formData,
  type SupabaseStub,
} from "@/test/supabase-stub";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/notifications/deliver", () => ({
  notify: vi.fn(async () => ({ recorded: 1, pushed: 1, pruned: 0 })),
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

const { decideLeave, submitLeave } = await import("./actions");
const { notify } = await import("@/lib/notifications/deliver");

const LEAVE = "44444444-4444-4444-8444-444444444444";
const STAFF = "22222222-2222-4222-8222-222222222222";

const decided = () =>
  stub.on("leave_requests", "update", {
    data: {
      user_id: STAFF,
      first_date: "2026-09-01",
      last_date: "2026-09-05",
      organisation_id: "org-1",
      property_id: "prop-1",
    },
  });

const decide = (over: Record<string, string> = {}) =>
  formData({ id: LEAVE, decision: "approved", ...over });

describe("decideLeave", () => {
  it("records the decision and who made it", async () => {
    decided();

    const result = await decideLeave({}, decide());

    expect(stub.onlyOp("leave_requests", "update").payload).toMatchObject({
      status: "approved",
      reviewed_by: MANAGER.id,
    });
    expect(result.error).toBeUndefined();
  });

  it("does NOT unroster conflicting shifts", async () => {
    decided();

    await decideLeave({}, decide());

    // Silently removing someone from a shift would leave it uncovered with
    // nobody told. The manager sees the clash on screen and decides.
    expect(stub.opsFor("shifts")).toHaveLength(0);
  });

  it("keeps dates and reasons out of the notification", async () => {
    decided();

    await decideLeave({}, decide());

    // Leave reasons can be medical, and this lands on a lock screen.
    const call = vi.mocked(notify).mock.calls[0][0];
    expect(call.body).toBe("Your leave request has been approved.");
    expect(call.body).not.toContain("2026");
  });

  it("declines without saying why on the lock screen", async () => {
    decided();

    await decideLeave({}, decide({ decision: "declined" }));

    const call = vi.mocked(notify).mock.calls[0][0];
    expect(call.title).toBe("Leave declined");
    expect(call.body).toMatch(/open stayflow for details/i);
  });

  it("surfaces the self-approval guard from the database", async () => {
    stub.on("leave_requests", "update", {
      error: { message: "You may not decide your own leave request." },
    });

    const result = await decideLeave({}, decide());

    // The guard raises rather than matching no rows, so the real reason is
    // worth showing.
    expect(result.error).toMatch(/your own leave request/i);
    expect(notify).not.toHaveBeenCalled();
  });

  it("reports a request that has already gone", async () => {
    stub.on("leave_requests", "update", { data: null });

    const result = await decideLeave({}, decide());

    expect(result.error).toMatch(/no longer available/i);
    expect(notify).not.toHaveBeenCalled();
  });

  it("says when the decision landed but the person was not told", async () => {
    decided();
    vi.mocked(notify).mockResolvedValueOnce({
      recorded: 0,
      pushed: 0,
      pruned: 0,
      error: "push service unavailable",
    });

    const result = await decideLeave({}, decide());

    // The decision is real. Calling it a failure would be wrong; saying
    // nothing would leave someone waiting for an answer already given.
    expect(result.error ?? result.success).toBeTruthy();
    expect(String(result.success ?? result.error)).toMatch(/not.*notified|could not/i);
  });

  it("rejects an unknown decision", async () => {
    const result = await decideLeave({}, decide({ decision: "later" }));
    expect(result.error).toMatch(/could not be identified/i);
    expect(stub.operations).toHaveLength(0);
  });
});

describe("submitLeave validation", () => {
  const ask = (over: Record<string, string> = {}) =>
    formData({
      category: "annual",
      firstDate: "2026-09-01",
      lastDate: "2026-09-05",
      ...over,
    });

  it("refuses a last day before the first", async () => {
    const result = await submitLeave({}, ask({ lastDate: "2026-08-01" }));
    expect(result.fieldErrors?.lastDate).toMatch(/last day cannot be before/i);
    expect(stub.operations).toHaveLength(0);
  });

  it("needs both times for partial-day leave", async () => {
    const result = await submitLeave(
      {},
      ask({ isPartialDay: "on", lastDate: "2026-09-01" }),
    );
    expect(result.fieldErrors?.startTime).toMatch(/needs a start and finish time/i);
  });

  it("needs the finish after the start", async () => {
    const result = await submitLeave(
      {},
      ask({
        isPartialDay: "on",
        lastDate: "2026-09-01",
        startTime: "14:00",
        endTime: "09:00",
      }),
    );
    expect(result.fieldErrors?.endTime).toMatch(/finish time must be after/i);
  });

  it("keeps partial-day leave to a single day", async () => {
    const result = await submitLeave(
      {},
      ask({ isPartialDay: "on", startTime: "09:00", endTime: "12:00" }),
    );
    expect(result.fieldErrors?.lastDate).toMatch(/single day/i);
  });

  it("hands the submission back so nothing is retyped", async () => {
    const result = await submitLeave({}, ask({ lastDate: "2026-08-01" }));
    expect(result.values).toMatchObject({
      category: "annual",
      firstDate: "2026-09-01",
    });
  });

  it("refuses an unknown leave type", async () => {
    const result = await submitLeave({}, ask({ category: "sabbatical" }));
    expect(result.fieldErrors?.category).toMatch(/choose a leave type/i);
  });
});
