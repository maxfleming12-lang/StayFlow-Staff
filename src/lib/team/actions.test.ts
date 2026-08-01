import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANAGER,
  createSupabaseStub,
  formData,
  hasFilter,
  type SupabaseStub,
} from "@/test/supabase-stub";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireRole: vi.fn(async () => MANAGER),
  requireUser: vi.fn(async () => MANAGER),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => stub.client),
  createServiceRoleClient: vi.fn(() => stub.client),
}));

let stub: SupabaseStub;
let createUser: ReturnType<typeof vi.fn>;
let deleteUser: ReturnType<typeof vi.fn>;
let rpc: ReturnType<typeof vi.fn>;

const NEW_USER = "99999999-9999-4999-8999-999999999999";
const PROPERTY = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  stub = createSupabaseStub();
  createUser = vi.fn(async () => ({
    data: { user: { id: NEW_USER } },
    error: null,
  }));
  deleteUser = vi.fn(async () => ({ error: null }));
  rpc = vi.fn(async () => ({ data: null, error: null }));
  Object.assign(stub.client as Record<string, unknown>, {
    rpc,
    auth: { admin: { createUser, deleteUser } },
  });
  vi.clearAllMocks();
});

const { addBasicStaff, inviteStaff, setStaffActive } = await import("./actions");
const { requireRole } = await import("@/lib/auth/session");

describe("inviteStaff", () => {
  const invite = (over: Record<string, string | string[]> = {}) =>
    formData({
      email: "aroha@example.com",
      firstName: "Aroha",
      lastName: "Whitiora",
      role: "staff",
      propertyIds: [PROPERTY],
      ...over,
    });

  it("requires an administrator", async () => {
    await inviteStaff({}, invite());
    expect(requireRole).toHaveBeenCalledWith("administrator");
  });

  it("will not hand out the OWNER role", async () => {
    const result = await inviteStaff({}, invite({ role: "owner" }));

    // Granting ownership is guarded in the database too, but it must not be
    // reachable from a staff-onboarding form at all.
    expect(result.error).toBeTruthy();
    expect(createUser).not.toHaveBeenCalled();
  });

  it("rejects a role that is not a role", async () => {
    const result = await inviteStaff({}, invite({ role: "superuser" }));
    expect(result.error).toBeTruthy();
    expect(createUser).not.toHaveBeenCalled();
  });

  it("creates the account, profile, role and property access", async () => {
    const result = await inviteStaff({}, invite({ role: "manager" }));

    expect(createUser).toHaveBeenCalledTimes(1);
    expect(stub.onlyOp("profiles", "insert").payload).toMatchObject({
      id: NEW_USER,
      email: "aroha@example.com",
    });
    expect(stub.onlyOp("user_roles", "insert").payload).toMatchObject({
      user_id: NEW_USER,
      role: "manager",
    });
    expect(result.temporaryPassword).toEqual(expect.any(String));
  });

  it("shows the temporary password once, and only on success", async () => {
    const ok = await inviteStaff({}, invite());
    expect(ok.temporaryPassword?.length).toBeGreaterThan(8);

    stub = createSupabaseStub();
    Object.assign(stub.client as Record<string, unknown>, {
      rpc,
      auth: { admin: { createUser, deleteUser } },
    });
    stub.on("profiles", "insert", { error: { message: "duplicate" } });

    const failed = await inviteStaff({}, invite());
    expect(failed.temporaryPassword).toBeUndefined();
  });

  it("deletes the auth user when the profile insert fails", async () => {
    stub.on("profiles", "insert", { error: { message: "duplicate key" } });

    const result = await inviteStaff({}, invite());

    // Without the rollback an orphaned login exists that can sign in with no
    // profile, and the email becomes permanently unusable for a retry.
    expect(deleteUser).toHaveBeenCalledWith(NEW_USER);
    expect(result.error).toMatch(/could not create the profile/i);
  });

  it("deletes the auth user when the role insert fails", async () => {
    stub.on("user_roles", "insert", { error: { message: "denied" } });

    await inviteStaff({}, invite());

    // An account with no role is worse than none: it can sign in and sees
    // nothing, with no way to tell why.
    expect(deleteUser).toHaveBeenCalledWith(NEW_USER);
  });

  it("deletes the auth user when property access fails", async () => {
    stub.on("user_property_access", "insert", { error: { message: "denied" } });

    await inviteStaff({}, invite());

    expect(deleteUser).toHaveBeenCalledWith(NEW_USER);
  });

  it("says plainly when the email is already taken", async () => {
    createUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "A user with this email address has already been registered" },
    });

    const result = await inviteStaff({}, invite());

    expect(result.error).toMatch(/already has an account/i);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("needs at least one property", async () => {
    const result = await inviteStaff({}, invite({ propertyIds: [] }));
    expect(result.error).toMatch(/at least one property/i);
    expect(createUser).not.toHaveBeenCalled();
  });
});

describe("addBasicStaff", () => {
  const add = (over: Record<string, string | string[]> = {}) =>
    formData({
      name: "Aroha Whitiora",
      jobTitle: "Housekeeping",
      pin: "481920",
      propertyIds: [PROPERTY],
      ...over,
    });

  it("always creates them as staff, never a role the form chose", async () => {
    await addBasicStaff({}, add());

    // This form has no role field. If it ever grows one, this must not
    // become the quiet path to a manager account.
    expect(stub.onlyOp("user_roles", "insert").payload).toMatchObject({
      role: "staff",
    });
  });

  it("refuses a predictable PIN", async () => {
    for (const pin of ["111111", "000000", "123456"]) {
      stub = createSupabaseStub();
      Object.assign(stub.client as Record<string, unknown>, {
        rpc,
        auth: { admin: { createUser, deleteUser } },
      });

      const result = await addBasicStaff({}, add({ pin }));

      expect(result.error, pin).toMatch(/less predictable/i);
      expect(createUser).not.toHaveBeenCalled();
    }
  });

  it("gives the account an unguessable synthetic email", async () => {
    await addBasicStaff({}, add());

    const email = String(createUser.mock.calls[0][0].email);
    // Kiosk staff have no real email. It must still be unique and not
    // derived from their name, which would be guessable.
    expect(email).toMatch(/^kiosk-[0-9a-f]{24}@staff\.stayflow\.invalid$/);
    expect(email).not.toMatch(/aroha/i);
  });

  it("sets the PIN through the database function, never in app code", async () => {
    await addBasicStaff({}, add());

    // The hash is built inside Postgres; no application code holds one.
    const call = rpc.mock.calls.find((c) => c[0] === "set_kiosk_pin");
    expect(call?.[1]).toMatchObject({ p_user: NEW_USER, p_pin: "481920" });
  });

  it("rolls the account back if the PIN cannot be set", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "pin in use" } });

    const result = await addBasicStaff({}, add());

    // A kiosk-only account with no PIN cannot clock on and cannot sign in
    // either — it is unusable, so it should not survive.
    expect(deleteUser).toHaveBeenCalledWith(NEW_USER);
    expect(result.error).toBeTruthy();
  });
});

describe("setStaffActive", () => {
  it("deactivates rather than deleting", async () => {
    const result = await setStaffActive(NEW_USER, false);

    // Deleting would destroy the roster and attendance history an employer
    // is required to keep.
    expect(stub.onlyOp("profiles", "update").payload).toEqual({
      is_active: false,
    });
    expect(stub.opsFor("profiles", "delete")).toHaveLength(0);
    expect(result.success).toMatch(/records are kept/i);
  });

  it("requires an administrator", async () => {
    await setStaffActive(NEW_USER, false);
    expect(requireRole).toHaveBeenCalledWith("administrator");
  });

  it("targets exactly one person", async () => {
    await setStaffActive(NEW_USER, true);
    expect(hasFilter(stub.onlyOp("profiles", "update"), "eq", "id", NEW_USER)).toBe(
      true,
    );
  });

  it("surfaces the owner guard from the database", async () => {
    stub.on("profiles", "update", {
      error: { message: "The organisation owner cannot be deactivated." },
    });

    const result = await setStaffActive(NEW_USER, false);

    expect(result.error).toMatch(/owner cannot be deactivated/i);
  });

  it("rejects an id that is not a uuid", async () => {
    const result = await setStaffActive("nope", false);
    expect(result.error).toMatch(/could not be identified/i);
    expect(stub.operations).toHaveLength(0);
  });
});
