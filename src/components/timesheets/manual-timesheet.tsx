"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/field";
import {
  createManualTimesheet,
  type TimesheetActionState,
} from "@/lib/timesheets/actions";

function SaveButton({ confirming }: { confirming: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? "Saving…" : confirming ? "Save anyway" : "Record hours"}
    </Button>
  );
}

/**
 * Enter hours by hand.
 *
 * Kept behind a disclosure so it does not compete with "Prepare a pay
 * period", which is the normal route. This is the exception path — a flat
 * phone battery, a tablet that was down, someone who covered before they
 * were rostered — and it is needed often enough that a motel cannot run
 * without it.
 */
export function ManualTimesheet({
  properties,
  staff,
  today,
}: {
  properties: { id: string; name: string }[];
  staff: { id: string; displayName: string }[];
  /** Today's date at the property, computed on the server to avoid a
   *  hydration mismatch and to avoid the browser's own timezone. */
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<TimesheetActionState, FormData>(
    createManualTimesheet,
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
          Enter hours manually
        </Button>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="manual-timesheet-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2
        id="manual-timesheet-heading"
        className="text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        Enter hours manually
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        For hours the time clock did not capture. The entry joins the list
        below for approval, exactly like a generated one.
      </p>

      {state.success && (
        <div className="mt-3">
          <Alert tone="success">{state.success}</Alert>
        </div>
      )}

      <form
        // Remount when the echoed values change so the restored entry is the
        // one the manager was just warned about.
        key={`${v?.userId ?? ""}|${v?.workDate ?? ""}`}
        action={formAction}
        className="mt-4 space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Property"
            htmlFor="manual-property"
            error={state.fieldErrors?.propertyId}
          >
            <select
              id="manual-property"
              name="propertyId"
              required
              defaultValue={v?.propertyId ?? properties[0]?.id}
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Staff member"
            htmlFor="manual-user"
            error={state.fieldErrors?.userId}
          >
            <select
              id="manual-user"
              name="userId"
              required
              defaultValue={v?.userId ?? ""}
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="" disabled>
                Choose staff…
              </option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Date worked"
            htmlFor="manual-date"
            error={state.fieldErrors?.workDate}
            hint="For an overnight shift, use the date it started."
          >
            <Input
              id="manual-date"
              name="workDate"
              type="date"
              required
              max={today}
              defaultValue={v?.workDate ?? today}
            />
          </Field>

          <Field
            label="Unpaid break (minutes)"
            htmlFor="manual-break"
            error={state.fieldErrors?.breakMinutes}
          >
            <Input
              id="manual-break"
              name="breakMinutes"
              type="number"
              min={0}
              max={600}
              step={5}
              defaultValue={v?.breakMinutes || "30"}
            />
          </Field>

          <Field
            label="Started"
            htmlFor="manual-start"
            error={state.fieldErrors?.startTime}
          >
            <Input
              id="manual-start"
              name="startTime"
              type="time"
              required
              step={300}
              defaultValue={v?.startTime ?? "09:00"}
            />
          </Field>

          <Field
            label="Finished"
            htmlFor="manual-end"
            error={state.fieldErrors?.endTime}
            hint="Earlier than the start means it ran past midnight."
          >
            <Input
              id="manual-end"
              name="endTime"
              type="time"
              required
              step={300}
              defaultValue={v?.endTime ?? "17:00"}
            />
          </Field>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="manual-note">Why it was entered by hand</Label>
          <textarea
            id="manual-note"
            name="managerNote"
            rows={2}
            maxLength={500}
            defaultValue={v?.managerNote ?? ""}
            placeholder="Phone was flat — hours confirmed with Aroha."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Saved on the timesheet, where the staff member can see it.
          </p>
        </div>

        {state.error && (
          <Alert tone={state.needsConfirmation ? "warning" : "error"}>
            {state.error}
          </Alert>
        )}

        {state.needsConfirmation && (
          <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              name="confirmDuplicate"
              required
              className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 dark:border-slate-600"
            />
            <span>
              Yes, add a second timesheet for this person on this date — they
              worked a split shift or a second property.
            </span>
          </label>
        )}

        <div className="flex gap-2">
          <SaveButton confirming={Boolean(state.needsConfirmation)} />
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </form>
    </section>
  );
}
