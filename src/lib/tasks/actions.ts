"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/roles";
import { localDateTimeToIso } from "@/lib/format";
import { notify } from "@/lib/notifications/deliver";
import type { Database } from "@/types/database";
import {
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  canTransition,
  isTaskStatus,
  type TaskStatus,
} from "./status";

export interface TaskActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
  /** Echoed back so a rejected form does not clear itself. */
  values?: Record<string, string>;
}

const createSchema = z.object({
  propertyId: z.string().uuid("Choose a property."),
  title: z.string().trim().min(1, "Give the job a title.").max(200),
  description: z.string().trim().max(2000).optional(),
  location: z.string().trim().max(120).optional(),
  category: z.enum(TASK_CATEGORIES),
  priority: z.enum(TASK_PRIORITIES),
  /** `datetime-local`, wall clock at the property. */
  dueAt: z.string().optional(),
  assigneeId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
});

/**
 * Create a job.
 *
 * Supervisor and above: a housekeeper completes tasks, they do not hand them
 * out. The database agrees — `tasks_write_management` is the insert path.
 */
export async function createTask(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const user = await requireRole("supervisor");

  const values: Record<string, string> = {
    propertyId: (formData.get("propertyId") as string) ?? "",
    title: (formData.get("title") as string) ?? "",
    description: (formData.get("description") as string) ?? "",
    location: (formData.get("location") as string) ?? "",
    category: (formData.get("category") as string) ?? "other",
    priority: (formData.get("priority") as string) ?? "normal",
    dueAt: (formData.get("dueAt") as string) ?? "",
    assigneeId: (formData.get("assigneeId") as string) ?? "",
  };

  const parsed = createSchema.safeParse({
    propertyId: formData.get("propertyId"),
    title: formData.get("title"),
    description: (formData.get("description") as string) || undefined,
    location: (formData.get("location") as string) || undefined,
    category: (formData.get("category") as string) || "other",
    priority: (formData.get("priority") as string) || "normal",
    dueAt: (formData.get("dueAt") as string) || undefined,
    assigneeId: (formData.get("assigneeId") as string) || undefined,
    teamId: (formData.get("teamId") as string) || undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors, error: "Check the highlighted fields.", values };
  }

  const input = parsed.data;

  // A due time typed at the property is wall clock there, like every other
  // time in this app.
  let dueAtIso: string | null = null;
  if (input.dueAt) {
    try {
      dueAtIso = localDateTimeToIso(input.dueAt);
    } catch {
      return {
        fieldErrors: { dueAt: "Enter a due time as a date and time." },
        error: "Check the due time.",
        values,
      };
    }
  }

  try {
    const supabase = await createClient();

    const { data: task, error } = await supabase
      .from("tasks")
      .insert({
        organisation_id: user.organisationId,
        property_id: input.propertyId,
        category: input.category,
        title: input.title,
        description: input.description ?? null,
        location: input.location ?? null,
        priority: input.priority,
        due_at: dueAtIso,
        // Assigning at creation is the normal case, so the status reflects
        // it rather than leaving every task sitting at `new`.
        status: input.assigneeId || input.teamId ? "assigned" : "new",
        created_by: user.id,
      })
      .select("id")
      .maybeSingle();

    if (error || !task) {
      return { error: `Could not create that job: ${error?.message ?? ""}`, values };
    }

    if (input.assigneeId || input.teamId) {
      const { error: assignError } = await supabase
        .from("task_assignments")
        .insert({
          organisation_id: user.organisationId,
          task_id: task.id,
          user_id: input.assigneeId ?? null,
          team_id: input.assigneeId ? null : (input.teamId ?? null),
          assigned_by: user.id,
        });

      if (assignError) {
        // The task exists but nobody holds it. Say so plainly rather than
        // reporting success and leaving it invisible to the person meant to
        // do it — `tasks_select` shows it to management only until assigned.
        return {
          error:
            "The job was created but could not be assigned. Open it and assign it.",
          values,
        };
      }

      if (input.assigneeId) {
        await notify({
          organisationId: user.organisationId,
          propertyId: input.propertyId,
          userIds: [input.assigneeId],
          category: "task_assigned",
          title: "New job for you",
          // No location or detail: this can appear on a locked phone.
          body: "A job has been assigned to you. Open StayFlow to see it.",
          deepLink: "/tasks",
        });
      }
    }
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly.", values };
  }

  revalidatePath("/tasks");
  return { success: "Job created." };
}

const statusSchema = z.object({
  taskId: z.string().uuid(),
  status: z.string().refine(isTaskStatus, "That is not a task status."),
});

/**
 * Move a task along.
 *
 * The transition is checked against the task's CURRENT status, read here
 * rather than trusted from the form: a stale screen must not be able to
 * complete a job that was cancelled ten minutes ago.
 *
 * Verifying is supervisor and above. `guard_task_verify` enforces that in
 * the database too, so this check is for the message, not the security.
 */
export async function setTaskStatus(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const user = await requireUser();

  const parsed = statusSchema.safeParse({
    taskId: formData.get("taskId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: "That job could not be identified." };

  const next = parsed.data.status as TaskStatus;

  try {
    const supabase = await createClient();

    const { data: task, error: readError } = await supabase
      .from("tasks")
      .select("id, status, property_id, organisation_id")
      .eq("id", parsed.data.taskId)
      .is("archived_at", null)
      .maybeSingle();

    if (readError) return { error: "Could not read that job." };
    if (!task) return { error: "That job is no longer available." };

    const current = String(task.status) as TaskStatus;
    if (!canTransition(current, next)) {
      return {
        error: `That job cannot go from ${current.replace("_", " ")} to ${next.replace("_", " ")}.`,
      };
    }

    if (next === "verified" && !atLeast(user.role, "supervisor")) {
      return { error: "Only a supervisor or above can check a job off." };
    }

    const stamps: Database["public"]["Tables"]["tasks"]["Update"] = {
      status: next,
    };
    if (next === "completed") {
      stamps.completed_by = user.id;
      stamps.completed_at = new Date().toISOString();
    }
    if (next === "verified") {
      stamps.verified_by = user.id;
      stamps.verified_at = new Date().toISOString();
    }
    if (next === "in_progress") {
      // Reopened. Clear the completion so the record does not claim the job
      // was finished at a time it was then sent back.
      stamps.completed_by = null;
      stamps.completed_at = null;
    }

    const { data: updated, error } = await supabase
      .from("tasks")
      .update(stamps)
      .eq("id", parsed.data.taskId)
      // Repeated in the write, so a status that changed between the read and
      // here cannot be overwritten from a stale screen.
      .eq("status", current)
      .select("id")
      .maybeSingle();

    if (error) return { error: error.message };
    if (!updated) {
      return {
        error: "Somebody else changed this job just now. Refresh to see it.",
      };
    }
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }

  revalidatePath("/tasks");
  return { success: "Job updated." };
}

const commentSchema = z.object({
  taskId: z.string().uuid(),
  body: z.string().trim().min(1, "Write something first.").max(2000),
});

/** Add a comment to a task. */
export async function addTaskComment(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const user = await requireUser();

  const parsed = commentSchema.safeParse({
    taskId: formData.get("taskId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("task_comments").insert({
      organisation_id: user.organisationId,
      task_id: parsed.data.taskId,
      user_id: user.id,
      body: parsed.data.body,
    });

    if (error) return { error: "Could not add that comment." };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }

  revalidatePath("/tasks");
  return { success: "Comment added." };
}
