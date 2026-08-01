"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Clock, MapPin, MessageSquare, Users } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { setTaskStatus, type TaskActionState } from "@/lib/tasks/actions";
import {
  TASK_STATUS_LABEL,
  allowedTransitions,
  isOverdue,
  type TaskStatus,
} from "@/lib/tasks/status";
import type { TaskRow } from "@/lib/tasks/queries";
import { cn } from "@/lib/utils";

const PRIORITY_STYLE: Record<string, string> = {
  urgent: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  high: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  normal: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  low: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

/** Plain words for a button, rather than the status it moves to. */
const ACTION_LABEL: Partial<Record<TaskStatus, string>> = {
  in_progress: "Start",
  waiting: "Put on hold",
  completed: "Mark done",
  verified: "Check off",
  cancelled: "Cancel",
  assigned: "Assign",
};

function TransitionButton({
  to,
  current,
}: {
  to: TaskStatus;
  current: TaskStatus;
}) {
  const { pending } = useFormStatus();
  // Reopening reads as "send back" only from a finished state.
  const label =
    to === "in_progress" && current === "completed"
      ? "Send back"
      : (ACTION_LABEL[to] ?? TASK_STATUS_LABEL[to]);

  return (
    <Button
      type="submit"
      name="status"
      value={to}
      size="sm"
      variant={to === "cancelled" ? "ghost" : to === "completed" ? "primary" : "outline"}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * One job, with the moves that are actually available from where it is.
 *
 * The buttons come from the shared transition table, so a screen can never
 * offer a move the server will refuse — including "check off", which is
 * hidden below supervisor because the database rejects it.
 */
export function TaskCard({
  task,
  canVerify,
}: {
  task: TaskRow;
  canVerify: boolean;
}) {
  const [state, action] = useActionState<TaskActionState, FormData>(
    setTaskStatus,
    {},
  );

  const moves = allowedTransitions(task.status, canVerify);
  const overdue = isOverdue(task);

  return (
    <article
      className={cn(
        "rounded-xl border bg-white p-4 dark:bg-slate-900",
        overdue
          ? "border-red-300 dark:border-red-800"
          : "border-slate-200 dark:border-slate-800",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium text-slate-900 dark:text-slate-100">
            {task.title}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {task.propertyName} · {TASK_STATUS_LABEL[task.status]}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium",
            PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.normal,
          )}
        >
          {task.priority}
        </span>
      </div>

      {task.description && (
        <p className="mt-2 whitespace-pre-line text-sm text-slate-600 dark:text-slate-400">
          {task.description}
        </p>
      )}

      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-slate-600 dark:text-slate-400">
        {task.location && (
          <div className="flex items-center gap-1.5">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            <dt className="sr-only">Where</dt>
            <dd>{task.location}</dd>
          </div>
        )}
        {task.dueAt && (
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <dt className="sr-only">Due</dt>
            <dd className={overdue ? "font-medium text-red-700 dark:text-red-400" : ""}>
              {formatDateTime(task.dueAt)}
              {overdue && " — overdue"}
            </dd>
          </div>
        )}
        {task.assigneeNames.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
            <dt className="sr-only">Who</dt>
            <dd>{task.assigneeNames.join(", ")}</dd>
          </div>
        )}
        {task.commentCount > 0 && (
          <div className="flex items-center gap-1.5">
            <MessageSquare className="h-4 w-4 shrink-0" aria-hidden="true" />
            <dt className="sr-only">Comments</dt>
            <dd>{task.commentCount}</dd>
          </div>
        )}
      </dl>

      {task.checklist.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-400">
          {task.checklist.map((item, i) => (
            <li key={`${item.label}-${i}`} className="flex items-start gap-2">
              <span aria-hidden="true">{item.done ? "☑" : "☐"}</span>
              <span className={item.done ? "line-through opacity-60" : ""}>
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      )}

      {task.assigneeNames.length === 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          Nobody is assigned to this yet.
        </p>
      )}

      {state.error && (
        <div className="mt-3">
          <Alert tone="error">{state.error}</Alert>
        </div>
      )}

      {moves.length > 0 && (
        <form action={action} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="taskId" value={task.id} />
          {moves.map((to) => (
            <TransitionButton key={to} to={to} current={task.status} />
          ))}
        </form>
      )}
    </article>
  );
}
