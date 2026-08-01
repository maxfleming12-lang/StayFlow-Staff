/**
 * Task lifecycle.
 *
 * Pure, so the rules can be tested without a database. The database enforces
 * the one that matters for privilege — only a supervisor or above may verify
 * — and this module decides what a screen should OFFER, so nobody is shown a
 * button that can only fail.
 */

export const TASK_STATUSES = [
  "new",
  "assigned",
  "in_progress",
  "waiting",
  "completed",
  "verified",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  new: "New",
  assigned: "Assigned",
  in_progress: "In progress",
  waiting: "Waiting",
  completed: "Done",
  verified: "Checked",
  cancelled: "Cancelled",
};

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_CATEGORIES = [
  "housekeeping",
  "reception",
  "maintenance",
  "grounds",
  "linen",
  "stock",
  "safety",
  "management",
  "other",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

/**
 * Where a task may go next.
 *
 * `completed` can return to `in_progress` deliberately: a job checked by a
 * supervisor and found wanting has to be reopenable, and the alternative —
 * cancelling and recreating — loses the comments and the history of what
 * was actually done.
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  new: ["assigned", "in_progress", "cancelled"],
  assigned: ["in_progress", "waiting", "cancelled"],
  in_progress: ["waiting", "completed", "cancelled"],
  waiting: ["in_progress", "completed", "cancelled"],
  completed: ["verified", "in_progress"],
  // Terminal. Reopening something already signed off should be a new task,
  // so the record of what was verified stays true.
  verified: [],
  cancelled: [],
};

/** Statuses that mean the job is still live. */
export const OPEN_STATUSES: readonly TaskStatus[] = [
  "new",
  "assigned",
  "in_progress",
  "waiting",
];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    typeof value === "string" &&
    (TASK_STATUSES as readonly string[]).includes(value)
  );
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * What this person may move the task to.
 *
 * Verifying is filtered out below supervisor. The database refuses it
 * anyway; this stops a button appearing that could only produce an error.
 */
export function allowedTransitions(
  from: TaskStatus,
  canVerify: boolean,
): TaskStatus[] {
  return TRANSITIONS[from].filter((to) => to !== "verified" || canVerify);
}

export interface SortableTask {
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
}

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/**
 * Order for a work list: what to do next, first.
 *
 * Open before finished, then urgency, then what is due soonest. A task with
 * no due time sorts after one that has a time, because a deadline is
 * information and its absence is not.
 */
export function compareTasks(a: SortableTask, b: SortableTask): number {
  const aOpen = OPEN_STATUSES.includes(a.status);
  const bOpen = OPEN_STATUSES.includes(b.status);
  if (aOpen !== bOpen) return aOpen ? -1 : 1;

  const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (priority !== 0) return priority;

  if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return 0;
}

/** Past its due time and not finished. */
export function isOverdue(task: SortableTask, now: Date = new Date()): boolean {
  if (!task.dueAt || !OPEN_STATUSES.includes(task.status)) return false;
  return Date.parse(task.dueAt) < now.getTime();
}
