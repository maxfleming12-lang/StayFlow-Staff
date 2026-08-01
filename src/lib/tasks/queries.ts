import { createClient } from "@/lib/supabase/server";
import { compareTasks, type TaskCategory, type TaskPriority, type TaskStatus } from "./status";

/**
 * Task queries.
 *
 * RLS decides scope: `tasks_select` returns a task to management for their
 * properties, and to anybody it is assigned to directly or through their
 * team. So neither query filters by assignee — doing so would HIDE tasks a
 * manager is meant to oversee.
 */

export interface TaskRow {
  id: string;
  propertyId: string;
  propertyName: string;
  category: TaskCategory;
  title: string;
  description: string | null;
  location: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string | null;
  checklist: { label: string; done: boolean }[];
  completedAt: string | null;
  verifiedAt: string | null;
  assigneeNames: string[];
  commentCount: number;
}

const SELECT = `id, property_id, category, title, description, location,
  priority, status, due_at, checklist, completed_at, verified_at,
  properties!tasks_property_id_fkey ( name )`;

const LIMIT = 300;

function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return (value as Record<string, unknown>) ?? null;
}

/** A checklist is free-form jsonb; read it defensively. */
function parseChecklist(value: unknown): { label: string; done: boolean }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item as Record<string, unknown>;
      const label = typeof row?.label === "string" ? row.label : null;
      return label ? { label, done: Boolean(row.done) } : null;
    })
    .filter((item): item is { label: string; done: boolean } => item !== null);
}

/**
 * Tasks the caller can see, newest work first.
 *
 * `includeFinished` is false by default: a housekeeper opening this on a
 * phone wants what is left to do, not a month of completed jobs.
 */
export async function getTasks(
  options: { propertyId?: string; includeFinished?: boolean } = {},
): Promise<TaskRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("tasks")
    .select(SELECT)
    .is("archived_at", null)
    .limit(LIMIT);

  if (options.propertyId) query = query.eq("property_id", options.propertyId);
  if (!options.includeFinished) {
    query = query.in("status", ["new", "assigned", "in_progress", "waiting"]);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load tasks: ${error.message}`);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const taskIds = rows.map((row) => String(row.id));

  // Assignees and comment counts in two keyed reads rather than nested
  // embeds, which get expensive in postgrest-js's type layer for no gain.
  const assigneeNames = new Map<string, string[]>();
  const commentCounts = new Map<string, number>();

  if (taskIds.length > 0) {
    const [assignRes, commentRes] = await Promise.all([
      supabase
        .from("task_assignments")
        .select(
          "task_id, user_id, team_id, profiles ( preferred_name, legal_first_name ), teams ( name )",
        )
        .in("task_id", taskIds),
      supabase.from("task_comments").select("task_id").in("task_id", taskIds).is("archived_at", null),
    ]);

    for (const row of (assignRes.data ?? []) as unknown as Record<string, unknown>[]) {
      const taskId = String(row.task_id);
      const profile = one(row.profiles);
      const team = one(row.teams);
      const name = profile
        ? String(
            (profile.preferred_name as string | null)?.trim() ||
              profile.legal_first_name ||
              "Someone",
          )
        : team
          ? `${String(team.name)} team`
          : "Unassigned";
      assigneeNames.set(taskId, [...(assigneeNames.get(taskId) ?? []), name]);
    }

    for (const row of commentRes.data ?? []) {
      const taskId = String(row.task_id);
      commentCounts.set(taskId, (commentCounts.get(taskId) ?? 0) + 1);
    }
  }

  const tasks: TaskRow[] = rows.map((row) => {
    const property = one(row.properties);
    return {
      id: String(row.id),
      propertyId: String(row.property_id),
      propertyName: property ? String(property.name) : "Unknown",
      category: String(row.category) as TaskCategory,
      title: String(row.title),
      description: (row.description as string | null) ?? null,
      location: (row.location as string | null) ?? null,
      priority: String(row.priority) as TaskPriority,
      status: String(row.status) as TaskStatus,
      dueAt: (row.due_at as string | null) ?? null,
      checklist: parseChecklist(row.checklist),
      completedAt: (row.completed_at as string | null) ?? null,
      verifiedAt: (row.verified_at as string | null) ?? null,
      assigneeNames: assigneeNames.get(String(row.id)) ?? [],
      commentCount: commentCounts.get(String(row.id)) ?? 0,
    };
  });

  return tasks.sort(compareTasks);
}

/** Comments on one task, oldest first. */
export async function getTaskComments(taskId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("task_comments")
    .select("id, body, created_at, user_id, profiles ( preferred_name, legal_first_name )")
    .eq("task_id", taskId)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) throw new Error(`Could not load comments: ${error.message}`);

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const profile = one(row.profiles);
    return {
      id: String(row.id),
      body: String(row.body),
      createdAt: String(row.created_at),
      authorName: profile
        ? String(
            (profile.preferred_name as string | null)?.trim() ||
              profile.legal_first_name ||
              "Someone",
          )
        : "Someone",
    };
  });
}
