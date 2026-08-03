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
beforeEach(() => {
  stub = createSupabaseStub();
  vi.clearAllMocks();
});

const {
  copyWeek,
  saveWeekAsTemplate,
  applyTemplate,
  deleteTemplate,
  getTemplates,
} = await import("./template-actions");
const { requireRole } = await import("@/lib/auth/session");

const PROPERTY = "33333333-3333-4333-8333-333333333333";
const TEMPLATE = "44444444-4444-4444-8444-444444444444";
const STAFF = "22222222-2222-4222-8222-222222222222";
const TEAM = "55555555-5555-4555-8555-555555555555";
const ORG = MANAGER.organisationId;

/** 3 August 2026 is a Monday; the 10th is the Monday after. */
const SOURCE_WEEK = "2026-08-03";
const TARGET_WEEK = "2026-08-10";

/** A Tuesday 9am–5pm shift inside the source week. */
const sourceShift = (over: Record<string, unknown> = {}) => ({
  id: "shift-1",
  property_id: PROPERTY,
  user_id: STAFF,
  team_id: null,
  starts_at: "2026-08-04T09:00:00+10:00",
  ends_at: "2026-08-04T17:00:00+10:00",
  notes: "Front desk",
  required_role: "staff",
  is_open_shift: false,
  ...over,
});

/** The source read comes first, then the target-week count. */
const sourceThenCount = (shifts: unknown[], count = 0) => {
  stub.on("shifts", "select", { data: shifts, error: null });
  stub.on("shifts", "select", { data: [], error: null, count });
};

const copyForm = (over: Record<string, string> = {}) =>
  formData({
    sourceWeek: SOURCE_WEEK,
    targetWeek: TARGET_WEEK,
    propertyId: PROPERTY,
    ...over,
  });

describe("copyWeek", () => {
  it("requires a manager", async () => {
    sourceThenCount([sourceShift()]);
    await copyWeek({}, copyForm());
    expect(requireRole).toHaveBeenCalledWith("manager");
  });

  it("refuses to copy a week onto itself", async () => {
    const result = await copyWeek({}, copyForm({ targetWeek: SOURCE_WEEK }));

    expect(result.error).toContain("different week");
    expect(stub.opsFor("shifts")).toHaveLength(0);
  });

  it("lands the copy as a draft even when the source was published", async () => {
    // Duplicating a published week must not publish the new one. Staff would
    // get notifications for a roster the manager had not finished.
    sourceThenCount([sourceShift({ status: "published" })]);

    await copyWeek({}, copyForm());

    const rows = stub.onlyOp("shifts", "insert").payload as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("draft");
  });

  it("carries the assignment and the detail across", async () => {
    sourceThenCount([
      sourceShift({ team_id: TEAM, user_id: null, is_open_shift: true }),
    ]);

    await copyWeek({}, copyForm());

    const row = (stub.onlyOp("shifts", "insert").payload as Record<string, unknown>[])[0];
    expect(row.team_id).toBe(TEAM);
    expect(row.user_id).toBeNull();
    expect(row.is_open_shift).toBe(true);
    expect(row.notes).toBe("Front desk");
    expect(row.required_role).toBe("staff");
    expect(row.organisation_id).toBe(ORG);
    expect(row.created_by).toBe(MANAGER.id);
  });

  it("keeps the wall-clock time a week later", async () => {
    // 9am Tuesday copies to 9am the following Tuesday. Adding seven days of
    // milliseconds would preserve the instant and move the local time across
    // a daylight-saving boundary.
    sourceThenCount([sourceShift()]);

    await copyWeek({}, copyForm());

    const row = (stub.onlyOp("shifts", "insert").payload as Record<string, unknown>[])[0];
    expect(new Date(String(row.starts_at)).toISOString()).toBe(
      new Date("2026-08-11T09:00:00+10:00").toISOString(),
    );
  });

  it("refuses when the target week already has shifts", async () => {
    // Silently creating a second copy is how a week ends up double-rostered.
    sourceThenCount([sourceShift()], 4);

    const result = await copyWeek({}, copyForm());

    expect(result.error).toContain("already has 4 shifts");
    expect(stub.opsFor("shifts", "insert")).toHaveLength(0);
  });

  it("says so rather than failing when there is nothing to copy", async () => {
    stub.on("shifts", "select", { data: [], error: null });

    const result = await copyWeek({}, copyForm());

    expect(result.error).toContain("no shifts to copy");
    expect(stub.opsFor("shifts", "insert")).toHaveLength(0);
  });

  it("reads the source scoped to the property, the week, and unarchived", async () => {
    sourceThenCount([sourceShift()]);

    await copyWeek({}, copyForm());

    const read = stub.opsFor("shifts", "select")[0];
    expect(hasFilter(read, "eq", "property_id", PROPERTY)).toBe(true);
    expect(hasFilter(read, "is", "archived_at", null)).toBe(true);
    expect(read.filters.some((f) => f.method === "gte")).toBe(true);
    expect(read.filters.some((f) => f.method === "lt")).toBe(true);
  });

  it("mentions shifts that fell outside the source week", async () => {
    // A shift outside the range cannot be re-anchored, and quietly dropping
    // it would leave a hole the manager never hears about.
    sourceThenCount([
      sourceShift(),
      sourceShift({ id: "stray", starts_at: "2026-09-01T09:00:00+10:00", ends_at: "2026-09-01T17:00:00+10:00" }),
    ]);

    const result = await copyWeek({}, copyForm());

    expect(result.success).toContain("1 shift");
    expect(result.warning).toContain("1 shift");
    expect(result.warning).toContain("outside the source week");
  });

  it("rejects a malformed week", async () => {
    const result = await copyWeek({}, copyForm({ targetWeek: "next week" }));

    expect(result.error).toBeTruthy();
    expect(stub.opsFor("shifts")).toHaveLength(0);
  });
});

describe("saveWeekAsTemplate", () => {
  const saveForm = (over: Record<string, string> = {}) =>
    formData({
      weekStartDate: SOURCE_WEEK,
      propertyId: PROPERTY,
      name: "Standard summer week",
      ...over,
    });

  const templateCreated = () =>
    stub.on("roster_periods", "insert", { data: { id: TEMPLATE }, error: null });

  it("records the template as a roster period, not a roster", async () => {
    stub.on("shifts", "select", { data: [sourceShift()], error: null });
    templateCreated();

    await saveWeekAsTemplate({}, saveForm());

    const period = stub.onlyOp("roster_periods", "insert").payload as Record<
      string,
      unknown
    >;
    expect(period.is_template).toBe(true);
    expect(period.template_name).toBe("Standard summer week");
    expect(period.week_start_date).toBe(SOURCE_WEEK);
    expect(period.organisation_id).toBe(ORG);
  });

  it("archives the template's shift copies so they never reach a roster", async () => {
    // Template shifts must not appear on a real roster, a staff member's
    // screen, or a labour-cost total. They are read back explicitly by
    // roster_period_id when the template is applied.
    stub.on("shifts", "select", { data: [sourceShift()], error: null });
    templateCreated();

    await saveWeekAsTemplate({}, saveForm());

    const rows = stub.onlyOp("shifts", "insert").payload as Record<string, unknown>[];
    expect(rows[0].archived_at).toBeTruthy();
    expect(rows[0].roster_period_id).toBe(TEMPLATE);
    expect(rows[0].status).toBe("draft");
  });

  it("copies the week rather than moving it", async () => {
    // The real roster has to be left exactly as it was.
    stub.on("shifts", "select", { data: [sourceShift()], error: null });
    templateCreated();

    await saveWeekAsTemplate({}, saveForm());

    expect(stub.opsFor("shifts", "update")).toHaveLength(0);
    expect(stub.opsFor("shifts", "delete")).toHaveLength(0);
  });

  it("takes the period row back out when its shifts cannot be saved", async () => {
    // Otherwise an empty template sits in the manager's list and fails with
    // "no shifts in it" every time it is applied — a choice offered that
    // cannot work.
    stub.on("shifts", "select", { data: [sourceShift()], error: null });
    templateCreated();
    stub.on("shifts", "insert", {
      data: null,
      error: { message: "violates check constraint" },
    });

    const result = await saveWeekAsTemplate({}, saveForm());

    expect(result.error).toContain("violates check constraint");
    expect(
      hasFilter(stub.onlyOp("roster_periods", "delete"), "eq", "id", TEMPLATE),
    ).toBe(true);
  });

  it("refuses to save an empty week", async () => {
    stub.on("shifts", "select", { data: [], error: null });

    const result = await saveWeekAsTemplate({}, saveForm());

    expect(result.error).toContain("no shifts to save");
    expect(stub.opsFor("roster_periods", "insert")).toHaveLength(0);
  });

  it("insists on a usable name", async () => {
    const result = await saveWeekAsTemplate({}, saveForm({ name: "x" }));

    expect(result.error).toContain("name");
    expect(stub.opsFor("shifts")).toHaveLength(0);
  });
});

describe("applyTemplate", () => {
  const applyForm = (over: Record<string, string> = {}) =>
    formData({ templateId: TEMPLATE, targetWeek: TARGET_WEEK, ...over });

  const templateFound = () =>
    stub.on("roster_periods", "select", {
      data: {
        id: TEMPLATE,
        property_id: PROPERTY,
        week_start_date: SOURCE_WEEK,
        template_name: "Standard summer week",
      },
      error: null,
    });

  it("only accepts a row that really is a template", async () => {
    templateFound();
    sourceThenCount([sourceShift()]);

    await applyTemplate({}, applyForm());

    expect(
      hasFilter(stub.onlyOp("roster_periods", "select"), "eq", "is_template", true),
    ).toBe(true);
  });

  it("reads the template's shifts despite them being archived", async () => {
    // They are archived by design, so the usual `archived_at is null` filter
    // would find nothing and every template would look empty.
    templateFound();
    sourceThenCount([sourceShift()]);

    await applyTemplate({}, applyForm());

    const read = stub.opsFor("shifts", "select")[0];
    expect(hasFilter(read, "eq", "roster_period_id", TEMPLATE)).toBe(true);
    expect(read.filters.some((f) => f.method === "is" && f.args[0] === "archived_at")).toBe(
      false,
    );
  });

  it("creates draft shifts on the target week", async () => {
    templateFound();
    sourceThenCount([sourceShift()]);

    const result = await applyTemplate({}, applyForm());

    const rows = stub.onlyOp("shifts", "insert").payload as Record<string, unknown>[];
    expect(rows[0].status).toBe("draft");
    expect(rows[0].archived_at).toBeUndefined();
    expect(result.success).toContain("Standard summer week");
  });

  it("refuses when the target week is already rostered", async () => {
    templateFound();
    sourceThenCount([sourceShift()], 2);

    const result = await applyTemplate({}, applyForm());

    expect(result.error).toContain("already has 2 shifts");
    expect(stub.opsFor("shifts", "insert")).toHaveLength(0);
  });

  it("reports a template that has gone", async () => {
    stub.on("roster_periods", "select", { data: null, error: null });

    const result = await applyTemplate({}, applyForm());

    expect(result.error).toContain("no longer available");
    expect(stub.opsFor("shifts")).toHaveLength(0);
  });

  it("reports an empty template", async () => {
    templateFound();
    stub.on("shifts", "select", { data: [], error: null });

    const result = await applyTemplate({}, applyForm());

    expect(result.error).toContain("no shifts in it");
  });
});

describe("deleteTemplate", () => {
  it("archives the template and only ever a template", async () => {
    await deleteTemplate(TEMPLATE);

    const update = stub.onlyOp("roster_periods", "update");
    expect((update.payload as Record<string, unknown>).archived_at).toBeTruthy();
    expect(hasFilter(update, "eq", "id", TEMPLATE)).toBe(true);
    // Without this a crafted id could archive a real roster period.
    expect(hasFilter(update, "eq", "is_template", true)).toBe(true);
    expect(stub.opsFor("roster_periods", "delete")).toHaveLength(0);
  });

  it("requires a manager", async () => {
    await deleteTemplate(TEMPLATE);
    expect(requireRole).toHaveBeenCalledWith("manager");
  });
});

describe("getTemplates", () => {
  it("lists live templates only", async () => {
    stub.on("roster_periods", "select", {
      data: [
        { id: TEMPLATE, template_name: "Summer", property_id: PROPERTY },
      ],
      error: null,
    });

    const templates = await getTemplates();

    const read = stub.onlyOp("roster_periods", "select");
    expect(hasFilter(read, "eq", "is_template", true)).toBe(true);
    expect(hasFilter(read, "is", "archived_at", null)).toBe(true);
    expect(templates).toEqual([
      { id: TEMPLATE, name: "Summer", propertyId: PROPERTY },
    ]);
  });

  it("narrows to one property when asked", async () => {
    await getTemplates(PROPERTY);

    expect(
      hasFilter(stub.onlyOp("roster_periods", "select"), "eq", "property_id", PROPERTY),
    ).toBe(true);
  });

  it("names an untitled template rather than showing a blank row", async () => {
    stub.on("roster_periods", "select", {
      data: [{ id: TEMPLATE, template_name: null, property_id: PROPERTY }],
      error: null,
    });

    expect((await getTemplates())[0].name).toBe("Untitled template");
  });

  it("returns nothing rather than throwing when the read fails", async () => {
    stub.on("roster_periods", "select", {
      data: null,
      error: { message: "permission denied" },
    });

    expect(await getTemplates()).toEqual([]);
  });
});
