"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/field";
import { submitLeave, type LeaveActionState } from "@/lib/leave/actions";
import { LEAVE_CATEGORIES } from "@/lib/leave/hours";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Submitting…" : "Submit request"}
    </Button>
  );
}

/**
 * Staff leave request form.
 *
 * Partial-day leave reveals the time fields only when chosen, so the common
 * case — a few whole days off — stays a three-field form.
 */
export function LeaveForm() {
  const [open, setOpen] = useState(false);
  const [partial, setPartial] = useState(false);
  const [state, formAction] = useActionState<LeaveActionState, FormData>(
    submitLeave,
    {},
  );

  const v = state.values;
  const today = new Date().toISOString().slice(0, 10);

  if (state.success) {
    return (
      <div className="space-y-3">
        <Alert tone="success">{state.success}</Alert>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Request more leave
        </Button>
      </div>
    );
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Request leave
      </Button>
    );
  }

  return (
    <section
      aria-labelledby="leave-form-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2
        id="leave-form-heading"
        className="text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        Request leave
      </h2>

      <form
        key={`${v?.firstDate ?? ""}|${v?.category ?? ""}`}
        action={formAction}
        className="mt-4 space-y-4"
      >
        <Field
          label="Leave type"
          htmlFor="leave-category"
          error={state.fieldErrors?.category}
        >
          <select
            id="leave-category"
            name="category"
            required
            defaultValue={v?.category || "annual"}
            className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {LEAVE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="First day"
            htmlFor="leave-first"
            error={state.fieldErrors?.firstDate}
          >
            <Input
              id="leave-first"
              name="firstDate"
              type="date"
              required
              min={today}
              defaultValue={v?.firstDate ?? ""}
            />
          </Field>

          <Field
            label="Last day"
            htmlFor="leave-last"
            error={state.fieldErrors?.lastDate}
          >
            <Input
              id="leave-last"
              name="lastDate"
              type="date"
              required
              min={today}
              defaultValue={v?.lastDate ?? ""}
            />
          </Field>
        </div>

        <label className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            name="isPartialDay"
            defaultChecked={v?.isPartialDay === "on"}
            onChange={(e) => setPartial(e.currentTarget.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
          />
          <span>
            Part of a day only
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              For example a medical appointment. Use the same date for first
              and last day.
            </span>
          </span>
        </label>

        {(partial || v?.isPartialDay === "on") && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="From"
              htmlFor="leave-start"
              error={state.fieldErrors?.startTime}
            >
              <Input
                id="leave-start"
                name="startTime"
                type="time"
                defaultValue={v?.startTime ?? ""}
              />
            </Field>
            <Field
              label="Until"
              htmlFor="leave-end"
              error={state.fieldErrors?.endTime}
            >
              <Input
                id="leave-end"
                name="endTime"
                type="time"
                defaultValue={v?.endTime ?? ""}
              />
            </Field>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="leave-note">Note for your manager (optional)</Label>
          <textarea
            id="leave-note"
            name="note"
            rows={2}
            maxLength={1000}
            defaultValue={v?.note ?? ""}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        {state.error && <Alert tone="error">{state.error}</Alert>}

        <div className="flex gap-2">
          <SubmitButton />
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
