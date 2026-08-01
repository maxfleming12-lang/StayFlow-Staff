"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/field";
import { createTask, type TaskActionState } from "@/lib/tasks/actions";
import { TASK_CATEGORIES, TASK_PRIORITIES } from "@/lib/tasks/status";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? "Creating…" : "Create job"}
    </Button>
  );
}

const SELECT_CLASS =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

/** Create a job and hand it to someone. */
export function TaskForm({
  properties,
  staff,
  defaultDueDate,
}: {
  properties: { id: string; name: string }[];
  staff: { id: string; displayName: string }[];
  /** `datetime-local` value for a sensible default due time. */
  defaultDueDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<TaskActionState, FormData>(
    createTask,
    {},
  );

  const v = state.values;

  if (!open) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        {state.success && (
          <div className="mb-3">
            <Alert tone="success">{state.success}</Alert>
          </div>
        )}
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New job
        </Button>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="task-form-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2
        id="task-form-heading"
        className="text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        New job
      </h2>

      {state.success && (
        <div className="mt-3">
          <Alert tone="success">{state.success}</Alert>
        </div>
      )}

      <form action={action} className="mt-4 space-y-4">
        <Field label="What needs doing" htmlFor="task-title" error={state.fieldErrors?.title}>
          <Input
            id="task-title"
            name="title"
            required
            maxLength={200}
            defaultValue={v?.title ?? ""}
            placeholder="Deep clean room 12"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Property" htmlFor="task-property" error={state.fieldErrors?.propertyId}>
            <select
              id="task-property"
              name="propertyId"
              required
              defaultValue={v?.propertyId ?? properties[0]?.id}
              className={SELECT_CLASS}
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Assign to" htmlFor="task-assignee" hint="Leave blank to assign later.">
            <select
              id="task-assignee"
              name="assigneeId"
              defaultValue={v?.assigneeId ?? ""}
              className={SELECT_CLASS}
            >
              <option value="">Nobody yet</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Type" htmlFor="task-category">
            <select
              id="task-category"
              name="category"
              defaultValue={v?.category ?? "housekeeping"}
              className={SELECT_CLASS}
            >
              {TASK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Priority" htmlFor="task-priority">
            <select
              id="task-priority"
              name="priority"
              defaultValue={v?.priority ?? "normal"}
              className={SELECT_CLASS}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Where" htmlFor="task-location" hint="A room number or area.">
            <Input
              id="task-location"
              name="location"
              maxLength={120}
              defaultValue={v?.location ?? ""}
              placeholder="Room 12"
            />
          </Field>

          <Field label="Due by" htmlFor="task-due" error={state.fieldErrors?.dueAt}>
            <Input
              id="task-due"
              name="dueAt"
              type="datetime-local"
              defaultValue={v?.dueAt ?? defaultDueDate}
            />
          </Field>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="task-description">Notes</Label>
          <textarea
            id="task-description"
            name="description"
            rows={2}
            maxLength={2000}
            defaultValue={v?.description ?? ""}
            placeholder="Guest checked out early — strip and remake before 2pm."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        {state.error && <Alert tone="error">{state.error}</Alert>}

        <div className="flex gap-2">
          <SubmitButton />
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </form>
    </section>
  );
}
