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

const { createAnnouncement, withdrawAnnouncement, acknowledgeAnnouncement } =
  await import("./actions");
const { notify } = await import("@/lib/notifications/deliver");
const { requireRole } = await import("@/lib/auth/session");

const NOTICE = "11111111-1111-4111-8111-111111111111";
const PROPERTY = "33333333-3333-4333-8333-333333333333";
const STILL_HERE = "22222222-2222-4222-8222-222222222222";
const LEFT = "55555555-5555-4555-8555-555555555555";
const ORG = MANAGER.organisationId;

const noticeForm = (over: Record<string, string> = {}) =>
  formData({
    title: "Water off Tuesday morning",
    body: "The mains are being replaced. Water will be off 8am to noon.",
    category: "general",
    audience: "all",
    ...over,
  });

/** The insert that creates the notice succeeds by default. */
const noticeCreated = () =>
  stub.on("announcements", "insert", { data: { id: NOTICE }, error: null });

describe("createAnnouncement", () => {
  it("requires a manager", async () => {
    noticeCreated();
    await createAnnouncement({}, noticeForm());
    expect(requireRole).toHaveBeenCalledWith("manager");
  });

  it("posts immediately rather than saving a draft", async () => {
    noticeCreated();

    const result = await createAnnouncement({}, noticeForm());

    const insert = stub.onlyOp("announcements", "insert").payload as Record<
      string,
      unknown
    >;
    expect(insert.status).toBe("published");
    expect(insert.published_at).toBeTruthy();
    expect(insert.published_by).toBe(MANAGER.id);
    expect(result.success).toBeTruthy();
  });

  it("aims an all-staff notice at everybody", async () => {
    noticeCreated();

    await createAnnouncement({}, noticeForm());

    const insert = stub.onlyOp("announcements", "insert").payload as Record<
      string,
      unknown
    >;
    expect(insert.property_id).toBeNull();

    const target = stub.onlyOp("announcement_recipients", "insert")
      .payload as Record<string, unknown>;
    expect(target.all_staff).toBe(true);
    expect(target.property_id).toBeNull();
  });

  it("aims a property notice at that property", async () => {
    noticeCreated();

    await createAnnouncement(
      {},
      noticeForm({ audience: "property", propertyId: PROPERTY }),
    );

    const target = stub.onlyOp("announcement_recipients", "insert")
      .payload as Record<string, unknown>;
    expect(target.all_staff).toBe(false);
    expect(target.property_id).toBe(PROPERTY);
  });

  it("insists on a property when the notice is for one", async () => {
    const result = await createAnnouncement({}, noticeForm({ audience: "property" }));

    expect(result.fieldErrors?.propertyId).toBeTruthy();
    expect(stub.opsFor("announcements", "insert")).toHaveLength(0);
  });

  it("says nobody can see it rather than reporting success", async () => {
    // `announcements_select_targeted` needs a recipient row. Without one the
    // notice exists and is invisible, which is the worst of both.
    noticeCreated();
    stub.on("announcement_recipients", "insert", {
      data: null,
      error: { message: "violates foreign key" },
    });

    const result = await createAnnouncement({}, noticeForm());

    expect(result.success).toBeUndefined();
    expect(result.error).toContain("nobody can see it");
  });

  it("reads an expiry as wall clock at the property", async () => {
    noticeCreated();

    await createAnnouncement({}, noticeForm({ expiresAt: "2026-08-05T17:00" }));

    const insert = stub.onlyOp("announcements", "insert").payload as Record<
      string,
      unknown
    >;
    expect(insert.expires_at).toBe("2026-08-05T07:00:00.000Z");
  });

  it("rejects an expiry that is not a date and time", async () => {
    const result = await createAnnouncement({}, noticeForm({ expiresAt: "soon" }));

    expect(result.fieldErrors?.expiresAt).toBeTruthy();
    expect(stub.opsFor("announcements", "insert")).toHaveLength(0);
  });

  it("sends an urgent notice under the category that ignores quiet hours", async () => {
    noticeCreated();

    await createAnnouncement({}, noticeForm({ isUrgent: "on" }));

    const sent = vi.mocked(notify).mock.calls[0][0];
    expect(sent.category).toBe("urgent_notice");
    expect(sent.title).toBe("Urgent notice");
  });

  it("sends an ordinary notice under the ordinary category", async () => {
    noticeCreated();

    await createAnnouncement({}, noticeForm());

    const sent = vi.mocked(notify).mock.calls[0][0];
    expect(sent.category).toBe("announcement");
  });

  it("keeps the notice text off a locked screen", async () => {
    // A manager writes a title for the notice board, not for a lock screen
    // somebody else may be looking at.
    noticeCreated();

    await createAnnouncement(
      {},
      noticeForm({ title: "Karen is being let go on Friday" }),
    );

    const sent = vi.mocked(notify).mock.calls[0][0];
    expect(sent.body).not.toContain("Karen");
    expect(sent.title).not.toContain("Karen");
  });
});

describe("who gets told", () => {
  it("tells only active staff about an all-staff notice", async () => {
    noticeCreated();

    await createAnnouncement({}, noticeForm());

    const profiles = stub.onlyOp("profiles", "select");
    expect(hasFilter(profiles, "eq", "organisation_id", ORG)).toBe(true);
    expect(hasFilter(profiles, "eq", "is_active", true)).toBe(true);
    expect(hasFilter(profiles, "is", "archived_at", null)).toBe(true);
  });

  it("does not tell somebody who has left about a property notice", async () => {
    // Deactivating a staff member flips `profiles.is_active` and leaves
    // their `user_property_access` row alone. Reading recipients straight
    // off that table kept notifying a former employee's phone, while an
    // all-staff notice correctly skipped them.
    noticeCreated();
    stub.on("user_property_access", "select", {
      data: [{ user_id: STILL_HERE }, { user_id: LEFT }],
      error: null,
    });
    // The database applies is_active; only the current employee comes back.
    stub.on("profiles", "select", { data: [{ id: STILL_HERE }], error: null });

    await createAnnouncement(
      {},
      noticeForm({ audience: "property", propertyId: PROPERTY }),
    );

    const sent = vi.mocked(notify).mock.calls[0][0];
    expect(sent.userIds).toEqual([STILL_HERE]);
    expect(sent.userIds).not.toContain(LEFT);
  });

  it("narrows a property notice to that property's people", async () => {
    noticeCreated();
    stub.on("user_property_access", "select", {
      data: [{ user_id: STILL_HERE }],
      error: null,
    });
    stub.on("profiles", "select", { data: [{ id: STILL_HERE }], error: null });

    await createAnnouncement(
      {},
      noticeForm({ audience: "property", propertyId: PROPERTY }),
    );

    const access = stub.onlyOp("user_property_access", "select");
    expect(hasFilter(access, "eq", "property_id", PROPERTY)).toBe(true);
    expect(hasFilter(access, "eq", "organisation_id", ORG)).toBe(true);

    const profiles = stub.onlyOp("profiles", "select");
    expect(hasFilter(profiles, "in", "id", [STILL_HERE])).toBe(true);
  });

  it("tells nobody when a property has nobody, rather than telling everybody", async () => {
    // Dropping the narrowing on an empty list would widen a single-property
    // notice to the whole organisation.
    noticeCreated();
    stub.on("user_property_access", "select", { data: [], error: null });

    await createAnnouncement(
      {},
      noticeForm({ audience: "property", propertyId: PROPERTY }),
    );

    const sent = vi.mocked(notify).mock.calls[0][0];
    expect(sent.userIds).toEqual([]);
    expect(stub.opsFor("profiles", "select")).toHaveLength(0);
  });

  it("counts a person once when they hold two rows for a property", async () => {
    noticeCreated();
    stub.on("user_property_access", "select", {
      data: [{ user_id: STILL_HERE }, { user_id: STILL_HERE }],
      error: null,
    });
    stub.on("profiles", "select", { data: [{ id: STILL_HERE }], error: null });

    await createAnnouncement(
      {},
      noticeForm({ audience: "property", propertyId: PROPERTY }),
    );

    expect(hasFilter(stub.onlyOp("profiles", "select"), "in", "id", [STILL_HERE])).toBe(
      true,
    );
  });
});

describe("withdrawAnnouncement", () => {
  const currently = (status: string) =>
    stub.on("announcements", "select", {
      data: { id: NOTICE, status },
      error: null,
    });

  it("withdraws rather than deleting, so the record survives", async () => {
    currently("published");
    stub.on("announcements", "update", { data: { id: NOTICE }, error: null });

    const result = await withdrawAnnouncement({}, formData({ id: NOTICE }));

    const update = stub.onlyOp("announcements", "update");
    expect((update.payload as Record<string, unknown>).status).toBe("withdrawn");
    expect(stub.opsFor("announcements", "delete")).toHaveLength(0);
    expect(result.success).toBeTruthy();
  });

  it("will not withdraw a notice twice", async () => {
    currently("withdrawn");

    const result = await withdrawAnnouncement({}, formData({ id: NOTICE }));

    expect(result.error).toContain("already been withdrawn");
    expect(stub.opsFor("announcements", "update")).toHaveLength(0);
  });

  it("constrains the write to the status it read", async () => {
    currently("published");
    stub.on("announcements", "update", { data: null, error: null });

    const result = await withdrawAnnouncement({}, formData({ id: NOTICE }));

    const update = stub.onlyOp("announcements", "update");
    expect(hasFilter(update, "eq", "status", "published")).toBe(true);
    expect(hasFilter(update, "eq", "id", NOTICE)).toBe(true);
    expect(result.error).toContain("Somebody else changed");
  });

  it("reports a notice that has gone", async () => {
    stub.on("announcements", "select", { data: null, error: null });

    const result = await withdrawAnnouncement({}, formData({ id: NOTICE }));

    expect(result.error).toContain("no longer available");
  });
});

describe("acknowledgeAnnouncement", () => {
  it("attributes the acknowledgement to the caller", async () => {
    await acknowledgeAnnouncement({}, formData({ id: NOTICE }));

    const upsert = stub.onlyOp("announcement_acknowledgements", "upsert")
      .payload as Record<string, unknown>;
    expect(upsert.user_id).toBe(MANAGER.id);
    expect(upsert.announcement_id).toBe(NOTICE);
    expect(upsert.organisation_id).toBe(ORG);
    expect(upsert.acknowledged_at).toBeTruthy();
  });

  it("rejects an id that is not a notice id", async () => {
    const result = await acknowledgeAnnouncement({}, formData({ id: "nope" }));

    expect(result.error).toBeTruthy();
    expect(stub.opsFor("announcement_acknowledgements")).toHaveLength(0);
  });
});
