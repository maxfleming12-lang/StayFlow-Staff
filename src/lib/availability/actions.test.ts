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

const { decideAvailability, submitAvailability } = await import("./actions");
const { notify } = await import("@/lib/notifications/deliver");

const ENTRY = "44444444-4444-4444-8444-444444444444";
const STAFF = "22222222-2222-4222-8222-222222222222";

const reviewed = () =>
  stub.on("staff_availability", "update", {
    data: { user_id: STAFF, organisation_id: "org-1" },
  });

const decide = (over: Record<string, string> = {}) =>
  formData({ id: ENTRY, decision: "approved", ...over });

describe("decideAvailability", () => {
  it("records the decision and the reviewer", async () => {
    reviewed();

    await decideAvailability({}, decide());

    // The conflict engine only consults APPROVED availability, so an
    // unreviewed submission warns nobody — this write is what makes a
    // staff member's stated availability count for anything.
    expect(stub.onlyOp("staff_availability", "update").payload).toMatchObject({
      status: "approved",
      reviewed_by: MANAGER.id,
    });
  });

  it("tells the person either way", async () => {
    reviewed();
    await decideAvailability({}, decide({ decision: "declined" }));
    expect(vi.mocked(notify).mock.calls[0][0].userIds).toEqual([STAFF]);
  });

  it("reports a submission that has gone", async () => {
    stub.on("staff_availability", "update", { data: null });

    const result = await decideAvailability({}, decide());

    expect(result.error).toMatch(/no longer available/i);
    expect(notify).not.toHaveBeenCalled();
  });

  it("surfaces a database refusal", async () => {
    stub.on("staff_availability", "update", {
      error: { message: "You may not review your own availability." },
    });

    const result = await decideAvailability({}, decide());

    expect(result.error).toMatch(/your own availability/i);
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects an unknown decision", async () => {
    const result = await decideAvailability({}, decide({ decision: "hmm" }));
    expect(result.error).toMatch(/could not be identified/i);
    expect(stub.operations).toHaveLength(0);
  });
});

describe("submitAvailability validation", () => {
  const recurring = (over: Record<string, string> = {}) =>
    formData({ kind: "recurring", dayOfWeek: "3", allDay: "on", ...over });

  it("needs a day for a recurring rule", async () => {
    const result = await submitAvailability({}, recurring({ dayOfWeek: "" }));
    expect(result.fieldErrors?.dayOfWeek).toBeTruthy();
    expect(stub.opsFor("staff_availability", "insert")).toHaveLength(0);
  });

  it("needs a date for a one-off rule", async () => {
    const result = await submitAvailability(
      {},
      formData({ kind: "date", allDay: "on" }),
    );
    expect(result.fieldErrors?.specificDate).toBeTruthy();
    expect(stub.opsFor("staff_availability", "insert")).toHaveLength(0);
  });

  it("needs both times when it is not all day", async () => {
    const result = await submitAvailability({}, recurring({ allDay: "" }));
    expect(result.fieldErrors?.startTime).toBeTruthy();
    expect(stub.opsFor("staff_availability", "insert")).toHaveLength(0);
  });

  it("needs the finish after the start", async () => {
    const result = await submitAvailability(
      {},
      recurring({ allDay: "", startTime: "18:00", endTime: "09:00" }),
    );
    expect(result.fieldErrors?.endTime).toBeTruthy();
    expect(stub.opsFor("staff_availability", "insert")).toHaveLength(0);
  });

  it("always arrives pending, never pre-approved", async () => {
    const result = await submitAvailability({}, recurring());

    expect(result.success).toBeTruthy();
    // RLS requires it too, but a submission that could arrive approved
    // would let someone silence the conflict engine about themselves.
    expect(stub.onlyOp("staff_availability", "insert").payload).toMatchObject({
      status: "pending",
      is_available: false,
    });
  });

  it("stores a recurring rule with no specific date, and vice versa", async () => {
    await submitAvailability({}, recurring());
    expect(stub.onlyOp("staff_availability", "insert").payload).toMatchObject({
      day_of_week: 3,
      specific_date: null,
      // All day, so no window — the conflict engine reads that as the
      // whole day rather than a zero-length one.
      start_time: null,
      end_time: null,
    });
  });
});
