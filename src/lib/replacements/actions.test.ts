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

const { decideReplacement, requestReplacement } = await import("./actions");
const { notify } = await import("@/lib/notifications/deliver");

const REQUEST = "44444444-4444-4444-8444-444444444444";
const SHIFT = "11111111-1111-4111-8111-111111111111";
const COVER = "22222222-2222-4222-8222-222222222222";
const ORIGINAL = "55555555-5555-4555-8555-555555555555";

const decide = (over: Record<string, string> = {}) =>
  formData({ id: REQUEST, decision: "approved", ...over });

const request = (over: Record<string, unknown> = {}) => ({
  id: REQUEST,
  shift_id: SHIFT,
  status: "claimed",
  replacement_user_id: COVER,
  requested_by: ORIGINAL,
  organisation_id: "org-1",
  ...over,
});

describe("decideReplacement", () => {
  it("moves the shift to its new holder", async () => {
    stub.on("shift_replacement_requests", "select", { data: request() });
    stub.on("shifts", "update", {
      data: {
        id: SHIFT,
        organisation_id: "org-1",
        property_id: "prop-1",
        starts_at: "2026-07-28T00:00:00.000Z",
      },
    });

    const result = await decideReplacement({}, decide());

    // Recording an approval without moving the shift would leave the
    // original person rostered while everyone believed it was covered.
    expect(stub.onlyOp("shifts", "update").payload).toEqual({
      user_id: COVER,
      is_open_shift: false,
    });
    expect(result.error).toBeUndefined();
  });

  it("moves the shift BEFORE recording the decision", async () => {
    stub.on("shift_replacement_requests", "select", { data: request() });
    stub.on("shifts", "update", {
      data: { id: SHIFT, organisation_id: "org-1", property_id: "prop-1" },
    });

    await decideReplacement({}, decide());

    // There is no transaction across the two writes. Whichever fails, the
    // surviving state must be honest, so the roster changes first.
    const order = stub.operations
      .filter(
        (o) =>
          (o.table === "shifts" && o.verb === "update") ||
          (o.table === "shift_replacement_requests" && o.verb === "update"),
      )
      .map((o) => o.table);
    expect(order).toEqual(["shifts", "shift_replacement_requests"]);
  });

  it("leaves the request claimable when the reassignment fails", async () => {
    stub.on("shift_replacement_requests", "select", { data: request() });
    stub.on("shifts", "update", { data: null });

    const result = await decideReplacement({}, decide());

    expect(result.error).toMatch(/could not move the shift/i);
    // Nothing recorded the decision, so it stays in the manager's queue to
    // retry. Marked approved first, it would have vanished from the queue
    // with the shift never moved and nobody watching.
    expect(stub.opsFor("shift_replacement_requests", "update")).toHaveLength(0);
  });

  it("hands the new holder a fresh acknowledgement, not the old one", async () => {
    stub.on("shift_replacement_requests", "select", { data: request() });
    stub.on("shifts", "update", {
      data: { id: SHIFT, organisation_id: "org-1", property_id: "prop-1" },
    });

    await decideReplacement({}, decide());

    // Inheriting somebody else's acceptance would show the new person as
    // having already confirmed a shift they have not seen.
    expect(stub.opsFor("shift_acknowledgements", "delete")).toHaveLength(1);
    expect(stub.onlyOp("shift_acknowledgements", "insert").payload).toMatchObject({
      shift_id: SHIFT,
      user_id: COVER,
      status: "pending",
    });
  });

  it("tells both the new holder and the person handing over", async () => {
    stub.on("shift_replacement_requests", "select", { data: request() });
    stub.on("shifts", "update", {
      data: { id: SHIFT, organisation_id: "org-1", property_id: "prop-1" },
    });

    await decideReplacement({}, decide());

    const recipients = vi.mocked(notify).mock.calls.flatMap((c) => c[0].userIds);
    expect(recipients).toContain(COVER);
    expect(recipients).toContain(ORIGINAL);
  });

  it("refuses to approve a request nobody has claimed", async () => {
    stub.on("shift_replacement_requests", "select", {
      data: request({ replacement_user_id: null, status: "offered" }),
    });

    const result = await decideReplacement({}, decide());

    expect(result.error).toMatch(/nobody has claimed this shift/i);
    expect(stub.opsFor("shifts", "update")).toHaveLength(0);
    expect(stub.opsFor("shift_replacement_requests", "update")).toHaveLength(0);
  });

  it("rejects without touching the roster", async () => {
    stub.on("shift_replacement_requests", "select", { data: request() });

    const result = await decideReplacement({}, decide({ decision: "rejected" }));

    // The original person is still rostered, which is the point of a
    // rejection.
    expect(stub.opsFor("shifts", "update")).toHaveLength(0);
    expect(
      stub.onlyOp("shift_replacement_requests", "update").payload,
    ).toMatchObject({ status: "rejected", reviewed_by: MANAGER.id });
    expect(result.error).toBeUndefined();
  });

  it("tells the requester they are still on when rejected", async () => {
    stub.on("shift_replacement_requests", "select", { data: request() });

    await decideReplacement({}, decide({ decision: "rejected" }));

    expect(vi.mocked(notify).mock.calls[0][0].body).toMatch(/still rostered/i);
  });

  it("surfaces the transition guard when the request was already decided", async () => {
    stub.on("shift_replacement_requests", "select", { data: request() });
    stub.on("shifts", "update", {
      data: { id: SHIFT, organisation_id: "org-1", property_id: "prop-1" },
    });
    stub.on("shift_replacement_requests", "update", {
      error: { message: "A replacement cannot move from rejected to approved." },
    });

    const result = await decideReplacement({}, decide());

    expect(result.error).toMatch(/cannot move from rejected to approved/i);
  });

  it("reports a request that has gone", async () => {
    stub.on("shift_replacement_requests", "select", { data: null });

    const result = await decideReplacement({}, decide());

    expect(result.error).toMatch(/no longer available/i);
    expect(stub.opsFor("shifts", "update")).toHaveLength(0);
  });

  it("rejects an unknown decision", async () => {
    const result = await decideReplacement({}, decide({ decision: "maybe" }));
    expect(result.error).toMatch(/could not be identified/i);
    expect(stub.operations).toHaveLength(0);
  });
});

describe("requestReplacement", () => {
  const ask = (over: Record<string, string> = {}) =>
    formData({ shiftId: SHIFT, reason: "Family commitment that day.", ...over });

  it("refuses a shift that is not yours", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: "somebody-else", organisation_id: "org-1" },
    });

    const result = await requestReplacement({}, ask());

    expect(result.error).toMatch(/not yours to hand over/i);
    expect(stub.opsFor("shift_replacement_requests", "insert")).toHaveLength(0);
  });

  it("refuses a second request for the same shift", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: MANAGER.id, organisation_id: "org-1" },
    });
    stub.on("shift_replacement_requests", "select", { data: { id: "existing" } });

    const result = await requestReplacement({}, ask());

    expect(result.error).toMatch(/already asked to be replaced/i);
    expect(stub.opsFor("shift_replacement_requests", "insert")).toHaveLength(0);
  });

  it("only counts live requests as duplicates", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: MANAGER.id, organisation_id: "org-1" },
    });
    stub.on("shift_replacement_requests", "select", { data: null });

    await requestReplacement({}, ask());

    // A withdrawn or rejected request must not block asking again.
    const existing = stub.opsFor("shift_replacement_requests", "select")[0];
    expect(
      hasFilter(existing, "in", "status", ["requested", "offered", "claimed"]),
    ).toBe(true);
  });

  it("insists on a reason a manager can act on", async () => {
    const result = await requestReplacement({}, ask({ reason: "no" }));
    expect(result.error).toMatch(/brief reason/i);
    expect(stub.operations).toHaveLength(0);
  });
});
