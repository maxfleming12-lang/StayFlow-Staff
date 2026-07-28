"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/field";
import {
  submitAvailability,
  type AvailabilityActionState,
} from "@/lib/availability/actions";
import { WEEKDAYS } from "@/lib/availability/rules";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Submitting…" : "Submit"}
    </Button>
  );
}

/**
 * Submit an availability rule.
 *
 * The availability question is asked positively — "Are you available?" —
 * rather than as a tick-to-mark-unavailable, because a double negative on a
 * phone at the end of a shift is easy to get backwards, and getting it
 * backwards puts someone on a roster they cannot work.
 */
export function AvailabilityForm() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"recurring" | "date">("recurring");
  const [allDay, setAllDay] = useState(true);
  const [state, formAction] = useActionState<AvailabilityActionState, FormData>(
    submitAvailability,
    {},
  );

  const v = state.values;
  const today = new Date().toISOString().slice(0, 10);

  if (state.success) {
    return (
      <div className="space-y-3">
        <Alert tone="success">{state.success}</Alert>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Add another
        </Button>
      </div>
    );
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add availability
      </Button>
    );
  }

  return (
    <section
      aria-labelledby="availability-form-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2
        id="availability-form-heading"
        className="text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        Add availability
      </h2>

      <form
        key={`${v?.kind ?? ""}|${v?.dayOfWeek ?? ""}|${v?.specificDate ?? ""}`}
        action={formAction}
        className="mt-4 space-y-4"
      >
        <fieldset>
          <legend className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Does this repeat?
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(
              [
                ["recurring", "Every week"],
                ["date", "One date only"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${
                  kind === value
                    ? "border-teal-600 bg-teal-50 font-medium text-teal-800 dark:bg-teal-950 dark:text-teal-300"
                    : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400"
                }`}
              >
                <input
                  type="radio"
                  name="kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {kind === "recurring" ? (
          <Field
            label="Day of the week"
            htmlFor="avail-day"
            error={state.fieldErrors?.dayOfWeek}
          >
            <select
              id="avail-day"
              name="dayOfWeek"
              defaultValue={v?.dayOfWeek ?? "1"}
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {WEEKDAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field
            label="Date"
            htmlFor="avail-date"
            hint="A single date overrides your usual weekly pattern."
            error={state.fieldErrors?.specificDate}
          >
            <Input
              id="avail-date"
              name="specificDate"
              type="date"
              min={today}
              defaultValue={v?.specificDate ?? ""}
            />
          </Field>
        )}

        <label className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            name="isAvailable"
            defaultChecked={v ? v.isAvailable === "on" : false}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
          />
          <span>
            I am available at this time
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              Leave unticked to tell your manager you are NOT available.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            name="allDay"
            defaultChecked={v ? v.allDay === "on" : true}
            onChange={(e) => setAllDay(e.currentTarget.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
          />
          <span>All day</span>
        </label>

        {!allDay && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="From"
              htmlFor="avail-start"
              error={state.fieldErrors?.startTime}
            >
              <Input
                id="avail-start"
                name="startTime"
                type="time"
                defaultValue={v?.startTime ?? ""}
              />
            </Field>
            <Field
              label="Until"
              htmlFor="avail-end"
              error={state.fieldErrors?.endTime}
            >
              <Input
                id="avail-end"
                name="endTime"
                type="time"
                defaultValue={v?.endTime ?? ""}
              />
            </Field>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="avail-note">Note (optional)</Label>
          <textarea
            id="avail-note"
            name="note"
            rows={2}
            maxLength={500}
            defaultValue={v?.note ?? ""}
            placeholder="Studying Wednesday mornings this semester."
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
