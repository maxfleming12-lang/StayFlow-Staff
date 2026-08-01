import { describe, expect, it } from "vitest";
import {
  OPEN_STATUSES,
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  allowedTransitions,
  canTransition,
  compareTasks,
  isOverdue,
  isTaskStatus,
  type SortableTask,
  type TaskStatus,
} from "./status";

const task = (over: Partial<SortableTask> = {}): SortableTask => ({
  status: "assigned",
  priority: "normal",
  dueAt: null,
  ...over,
});

describe("the lifecycle", () => {
  it("labels every status the database can hold", () => {
    // A status with no label renders as a raw enum value on a housekeeper's
    // phone.
    for (const status of TASK_STATUSES) {
      expect(TASK_STATUS_LABEL[status], status).toBeTruthy();
    }
  });

  it("lets work start, pause and finish", () => {
    expect(canTransition("new", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "waiting")).toBe(true);
    expect(canTransition("waiting", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "completed")).toBe(true);
    expect(canTransition("completed", "verified")).toBe(true);
  });

  it("lets a supervisor send unfinished work back", () => {
    // Cancelling and recreating would lose the comments and the record of
    // what was actually done.
    expect(canTransition("completed", "in_progress")).toBe(true);
  });

  it("treats verified and cancelled as final", () => {
    expect(allowedTransitions("verified", true)).toEqual([]);
    expect(allowedTransitions("cancelled", true)).toEqual([]);
  });

  it("refuses to skip straight from new to done", () => {
    expect(canTransition("new", "completed")).toBe(false);
    expect(canTransition("new", "verified")).toBe(false);
  });

  it("refuses to resurrect a cancelled task", () => {
    for (const to of TASK_STATUSES) {
      expect(canTransition("cancelled", to), to).toBe(false);
    }
  });

  it("never offers a transition to itself", () => {
    for (const status of TASK_STATUSES) {
      expect(canTransition(status, status), status).toBe(false);
    }
  });
});

describe("who may verify", () => {
  it("hides verifying from staff", () => {
    // The database refuses it regardless; this stops a button appearing
    // that could only produce an error.
    expect(allowedTransitions("completed", false)).not.toContain("verified");
    expect(allowedTransitions("completed", false)).toContain("in_progress");
  });

  it("offers it to a supervisor", () => {
    expect(allowedTransitions("completed", true)).toContain("verified");
  });

  it("does not otherwise change what is on offer", () => {
    expect(allowedTransitions("in_progress", false)).toEqual(
      allowedTransitions("in_progress", true),
    );
  });
});

describe("isTaskStatus", () => {
  it("accepts the real statuses", () => {
    for (const status of TASK_STATUSES) expect(isTaskStatus(status)).toBe(true);
  });

  it("rejects anything else arriving from a form", () => {
    for (const value of ["", "done", "DONE", "constructor", null, 7, undefined]) {
      expect(isTaskStatus(value)).toBe(false);
    }
  });
});

describe("compareTasks", () => {
  const order = (tasks: SortableTask[]) => [...tasks].sort(compareTasks);

  it("puts live work above finished work", () => {
    const sorted = order([
      task({ status: "verified", priority: "urgent" }),
      task({ status: "assigned", priority: "low" }),
    ]);
    // A finished urgent job is not what to do next.
    expect(sorted[0].status).toBe("assigned");
  });

  it("sorts by urgency within live work", () => {
    const sorted = order([
      task({ priority: "low" }),
      task({ priority: "urgent" }),
      task({ priority: "normal" }),
      task({ priority: "high" }),
    ]);
    expect(sorted.map((t) => t.priority)).toEqual([
      "urgent",
      "high",
      "normal",
      "low",
    ]);
  });

  it("puts the soonest due first at equal urgency", () => {
    const sorted = order([
      task({ dueAt: "2026-07-28T07:00:00.000Z" }),
      task({ dueAt: "2026-07-28T01:00:00.000Z" }),
    ]);
    expect(sorted[0].dueAt).toBe("2026-07-28T01:00:00.000Z");
  });

  it("puts a task with a deadline above one without", () => {
    const sorted = order([
      task({ dueAt: null }),
      task({ dueAt: "2026-07-28T07:00:00.000Z" }),
    ]);
    // A deadline is information; its absence is not.
    expect(sorted[0].dueAt).toBeTruthy();
  });

  it("is a stable, total order", () => {
    const tasks = [
      task({ priority: "urgent", dueAt: "2026-07-28T01:00:00.000Z" }),
      task({ status: "completed", priority: "urgent" }),
      task({ priority: "normal" }),
      task({ priority: "urgent", dueAt: null }),
    ];
    // Sorting twice must not reorder anything the second time.
    const once = [...tasks].sort(compareTasks);
    const twice = [...once].sort(compareTasks);
    expect(twice).toEqual(once);
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-07-28T06:00:00.000Z");

  it("flags live work past its due time", () => {
    expect(
      isOverdue(task({ dueAt: "2026-07-28T05:00:00.000Z" }), now),
    ).toBe(true);
  });

  it("does not flag work that is still in time", () => {
    expect(
      isOverdue(task({ dueAt: "2026-07-28T07:00:00.000Z" }), now),
    ).toBe(false);
  });

  it("does not flag finished work, however late it was", () => {
    for (const status of ["completed", "verified", "cancelled"] as TaskStatus[]) {
      expect(
        isOverdue(task({ status, dueAt: "2026-07-01T00:00:00.000Z" }), now),
        status,
      ).toBe(false);
    }
  });

  it("does not flag a task with no deadline", () => {
    expect(isOverdue(task({ dueAt: null }), now)).toBe(false);
  });

  it("agrees with OPEN_STATUSES about what counts as live", () => {
    for (const status of OPEN_STATUSES) {
      expect(
        isOverdue(task({ status, dueAt: "2026-07-01T00:00:00.000Z" }), now),
        status,
      ).toBe(true);
    }
  });
});
