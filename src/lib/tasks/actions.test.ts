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

const { createTask, setTaskStatus, addTaskComment } = await import("./actions");
const { notify } = await import("@/lib/notifications/deliver");
const { requireRole, requireUser } = await import("@/lib/auth/session");

const TASK = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const PROPERTY = "33333333-3333-4333-8333-333333333333";
const TEAM = "44444444-4444-4444-8444-444444444444";
const ORG = MANAGER.organisationId;

const asStaff = () =>
  vi.mocked(requireUser).mockResolvedValueOnce({
    ...MANAGER,
    role: "staff",
  } as never);

const taskForm = (over: Record<string, string> = {}) =>
  formData({
    propertyId: PROPERTY,
    title: "Change the linen in 12",
    category: "housekeeping",
    priority: "normal",
    ...over,
  });

describe("createTask", () => {
  it("is supervisor and above — a housekeeper does not hand out work", async () => {
    stub.on("tasks", "insert", { data: { id: TASK }, error: null });

    await createTask({}, taskForm());

    expect(requireRole).toHaveBeenCalledWith("supervisor");
  });

  it("reads a due time as wall clock at the property, not as UTC", async () => {
    // The bug this whole branch started with: 9am typed into a form became
    // 7pm. August is AEST, so 9am is 23:00 the previous day in UTC.
    stub.on("tasks", "insert", { data: { id: TASK }, error: null });

    await createTask({}, taskForm({ dueAt: "2026-08-05T09:00" }));

    const insert = stub.onlyOp("tasks", "insert").payload as Record<string, unknown>;
    expect(insert.due_at).toBe("2026-08-04T23:00:00.000Z");
  });

  it("follows the property into daylight saving", async () => {
    // January is AEDT, an hour further ahead. A fixed offset would put this
    // an hour out for half the year.
    stub.on("tasks", "insert", { data: { id: TASK }, error: null });

    await createTask({}, taskForm({ dueAt: "2026-01-15T09:00" }));

    const insert = stub.onlyOp("tasks", "insert").payload as Record<string, unknown>;
    expect(insert.due_at).toBe("2026-01-14T22:00:00.000Z");
  });

  it("leaves the due time empty rather than inventing one", async () => {
    stub.on("tasks", "insert", { data: { id: TASK }, error: null });

    await createTask({}, taskForm());

    const insert = stub.onlyOp("tasks", "insert").payload as Record<string, unknown>;
    expect(insert.due_at).toBeNull();
  });

  it("opens a job nobody holds as new", async () => {
    stub.on("tasks", "insert", { data: { id: TASK }, error: null });

    await createTask({}, taskForm());

    const insert = stub.onlyOp("tasks", "insert").payload as Record<string, unknown>;
    expect(insert.status).toBe("new");
    expect(stub.opsFor("task_assignments", "insert")).toHaveLength(0);
  });

  it("opens an assigned job as assigned", async () => {
    stub.on("tasks", "insert", { data: { id: TASK }, error: null });

    await createTask({}, taskForm({ assigneeId: STAFF }));

    const insert = stub.onlyOp("tasks", "insert").payload as Record<string, unknown>;
    expect(insert.status).toBe("assigned");

    const assignment = stub.onlyOp("task_assignments", "insert")
      .payload as Record<string, unknown>;
    expect(assignment.user_id).toBe(STAFF);
    expect(assignment.assigned_by).toBe(MANAGER.id);
    expect(assignment.organisation_id).toBe(ORG);
  });

  it("gives the job to the person, not the team, when both are named", async () => {
    stub.on("tasks", "insert", { data: { id: TASK }, error: null });

    await createTask({}, taskForm({ assigneeId: STAFF, teamId: TEAM }));

    const assignment = stub.onlyOp("task_assignments", "insert")
      .payload as Record<string, unknown>;
    expect(assignment.user_id).toBe(STAFF);
    expect(assignment.team_id).toBeNull();
  });

  it("assigns to a team when nobody is named", async () => {
    stub.on("tasks", "insert", { data: { id: TASK }, error: null });

    await createTask({}, taskForm({ teamId: TEAM }));

    const assignment = stub.onlyOp("task_assignments", "insert")
      .payload as Record<string, unknown>;
    expect(assignment.team_id).toBe(TEAM);
    expect(assignment.user_id).toBeNull();
  });

  it("tells the person the job is theirs", async () => {
    stub.on("tasks", "insert", { data: { id: TASK }, error: null });

    await createTask({}, taskForm({ assigneeId: STAFF }));

    expect(notify).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(notify).mock.calls[0][0];
    expect(sent.userIds).toEqual([STAFF]);
    expect(sent.category).toBe("task_assigned");
  });

  it("keeps the job off a locked screen", async () => {
    // A notification body appears on a lock screen, so it carries no room
    // number, location or detail.
    stub.on("tasks", "insert", { data: { id: TASK }, error: null });

    await createTask({}, taskForm({ assigneeId: STAFF, location: "Room 12" }));

    const sent = vi.mocked(notify).mock.calls[0][0];
    expect(sent.body).not.toContain("12");
    expect(sent.title).not.toContain("12");
  });

  it("notifies nobody for a team assignment", async () => {
    // Documented, not endorsed: a team job reaches no phone. It is visible
    // in the list, but nobody is told it arrived.
    stub.on("tasks", "insert", { data: { id: TASK }, error: null });

    await createTask({}, taskForm({ teamId: TEAM }));

    expect(notify).not.toHaveBeenCalled();
  });

  it("says the job was created but not assigned, rather than claiming success", async () => {
    // `tasks_select` shows an unassigned job to management only, so
    // reporting success here would leave it invisible to the person meant
    // to do it.
    stub.on("tasks", "insert", { data: { id: TASK }, error: null });
    stub.on("task_assignments", "insert", {
      data: null,
      error: { message: "violates foreign key" },
    });

    const result = await createTask({}, taskForm({ assigneeId: STAFF }));

    expect(result.success).toBeUndefined();
    expect(result.error).toContain("could not be assigned");
  });

  it("hands back what was typed when the form is rejected", async () => {
    const result = await createTask({}, taskForm({ title: "   " }));

    expect(result.fieldErrors?.title).toBe("Give the job a title.");
    expect(result.values?.propertyId).toBe(PROPERTY);
    expect(stub.opsFor("tasks", "insert")).toHaveLength(0);
  });

  it("rejects a due time that is not a date and time", async () => {
    const result = await createTask({}, taskForm({ dueAt: "next Tuesday" }));

    expect(result.fieldErrors?.dueAt).toBeTruthy();
    expect(stub.opsFor("tasks", "insert")).toHaveLength(0);
  });
});

describe("setTaskStatus", () => {
  const currently = (status: string) =>
    stub.on("tasks", "select", {
      data: { id: TASK, status, property_id: PROPERTY, organisation_id: ORG },
      error: null,
    });

  it("checks the transition against the stored status, not the form", async () => {
    // A screen left open on a cancelled job must not be able to complete it.
    currently("cancelled");

    const result = await setTaskStatus(
      {},
      formData({ taskId: TASK, status: "completed" }),
    );

    expect(result.error).toContain("cannot go from cancelled to completed");
    expect(stub.opsFor("tasks", "update")).toHaveLength(0);
  });

  it("moves a job along when the transition is allowed", async () => {
    currently("in_progress");
    stub.on("tasks", "update", { data: { id: TASK }, error: null });

    const result = await setTaskStatus(
      {},
      formData({ taskId: TASK, status: "completed" }),
    );

    expect(result.success).toBeTruthy();
    const update = stub.onlyOp("tasks", "update").payload as Record<string, unknown>;
    expect(update.status).toBe("completed");
    expect(update.completed_by).toBe(MANAGER.id);
    expect(update.completed_at).toBeTruthy();
  });

  it("will not let a staff member check a job off", async () => {
    currently("completed");
    asStaff();

    const result = await setTaskStatus(
      {},
      formData({ taskId: TASK, status: "verified" }),
    );

    expect(result.error).toContain("supervisor");
    expect(stub.opsFor("tasks", "update")).toHaveLength(0);
  });

  it("lets a manager check a job off and records who did", async () => {
    currently("completed");
    stub.on("tasks", "update", { data: { id: TASK }, error: null });

    await setTaskStatus({}, formData({ taskId: TASK, status: "verified" }));

    const update = stub.onlyOp("tasks", "update").payload as Record<string, unknown>;
    expect(update.verified_by).toBe(MANAGER.id);
    expect(update.verified_at).toBeTruthy();
  });

  it("clears the completion when a job is sent back", async () => {
    // Otherwise the record claims the job was finished at a time it was
    // then reopened.
    currently("completed");
    stub.on("tasks", "update", { data: { id: TASK }, error: null });

    await setTaskStatus({}, formData({ taskId: TASK, status: "in_progress" }));

    const update = stub.onlyOp("tasks", "update").payload as Record<string, unknown>;
    expect(update.completed_by).toBeNull();
    expect(update.completed_at).toBeNull();
  });

  it("constrains the write to the status it read", async () => {
    // Two people pressing at once: the second write matches nothing rather
    // than overwriting the first from a stale screen.
    currently("in_progress");
    stub.on("tasks", "update", { data: null, error: null });

    const result = await setTaskStatus(
      {},
      formData({ taskId: TASK, status: "completed" }),
    );

    const update = stub.onlyOp("tasks", "update");
    expect(hasFilter(update, "eq", "status", "in_progress")).toBe(true);
    expect(hasFilter(update, "eq", "id", TASK)).toBe(true);
    expect(result.error).toContain("Somebody else changed this job");
  });

  it("ignores an archived job", async () => {
    currently("in_progress");

    await setTaskStatus({}, formData({ taskId: TASK, status: "completed" }));

    expect(
      hasFilter(stub.onlyOp("tasks", "select"), "is", "archived_at", null),
    ).toBe(true);
  });

  it("refuses a status that is not one of ours", async () => {
    const result = await setTaskStatus(
      {},
      formData({ taskId: TASK, status: "nearly_done" }),
    );

    expect(result.error).toBeTruthy();
    expect(stub.opsFor("tasks")).toHaveLength(0);
  });

  it("reports a job that has gone rather than failing silently", async () => {
    stub.on("tasks", "select", { data: null, error: null });

    const result = await setTaskStatus(
      {},
      formData({ taskId: TASK, status: "completed" }),
    );

    expect(result.error).toContain("no longer available");
  });
});

describe("addTaskComment", () => {
  it("attributes the comment to the caller", async () => {
    await addTaskComment({}, formData({ taskId: TASK, body: "Linen delivered." }));

    const insert = stub.onlyOp("task_comments", "insert").payload as Record<
      string,
      unknown
    >;
    expect(insert.user_id).toBe(MANAGER.id);
    expect(insert.task_id).toBe(TASK);
    expect(insert.organisation_id).toBe(ORG);
    expect(insert.body).toBe("Linen delivered.");
  });

  it("refuses an empty comment", async () => {
    const result = await addTaskComment({}, formData({ taskId: TASK, body: "   " }));

    expect(result.error).toBe("Write something first.");
    expect(stub.opsFor("task_comments")).toHaveLength(0);
  });
});
