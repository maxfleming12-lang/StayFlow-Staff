"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Info, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/field";
import {
  saveShift,
  type RosterActionState,
} from "@/lib/roster/manager-actions";
import type {
  RosterProperty,
  RosterStaff,
} from "@/lib/roster/manager-queries";
import type { Conflict } from "@/lib/roster/conflicts";

function SubmitButton({ needsOverride }: { needsOverride: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending
        ? "Saving…"
        : needsOverride
          ? "Roster anyway"
          : "Add to draft roster"}
    </Button>
  );
}

/**
 * The conflict list returned by the server.
 *
 * Warnings and advisories are visually distinct because they mean different
 * things: a warning demands a recorded reason, an advisory is information
 * the manager may simply already know.
 */
function ConflictList({ conflicts }: { conflicts: Conflict[] }) {
  if (conflicts.length === 0) return null;

  return (
    <ul className="space-y-2">
      {conflicts.map((conflict, index) => {
        const isWarning = conflict.severity === "warning";
        const Icon = isWarning ? AlertTriangle : Info;
        return (
          <li
            key={`${conflict.kind}-${index}`}
            className={
              isWarning
                ? "flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
                : "flex gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            }
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{conflict.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Add or edit a shift.
 *
 * Warnings never block. When the server reports a warning-level conflict it
 * returns without saving and asks for a reason; resubmitting with one records
 * it against the shift. A motel manager routinely knows something the roster
 * does not — that the staff member offered to cover, that the leave was
 * cancelled verbally — so the system asks rather than refuses.
 */
export function ShiftForm({
  properties,
  staff,
  defaultDate,
}: {
  properties: RosterProperty[];
  staff: RosterStaff[];
  defaultDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<RosterActionState, FormData>(
    saveShift,
    {},
  );

  // Restore what was submitted. Without this the conflict re-render resets
  // every uncontrolled input to its default, so a manager could acknowledge
  // a warning about one shift and save a completely different one.
  const v = state.values;

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add shift
      </Button>
    );
  }

  return (
    <section
      aria-labelledby="add-shift-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2
        id="add-shift-heading"
        className="text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        Add a shift
      </h2>

      {state.success && (
        <div className="mt-3">
          <Alert tone="success">{state.success}</Alert>
        </div>
      )}

      <form
        key={`${v?.startsAt ?? ""}|${v?.userId ?? ""}|${v?.propertyId ?? ""}`}
        action={formAction}
        className="mt-4 space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Property"
            htmlFor="shift-property"
            error={state.fieldErrors?.propertyId}
          >
            <select
              id="shift-property"
              name="propertyId"
              defaultValue={v?.propertyId ?? properties[0]?.id}
              required
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
            htmlFor="shift-user"
            hint="Leave unassigned to create an open shift."
          >
            <select
              id="shift-user"
              name="userId"
              defaultValue={v?.userId ?? ""}
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Unassigned (open shift)</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                  {s.jobTitle ? ` — ${s.jobTitle}` : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Starts"
            htmlFor="shift-start"
            error={state.fieldErrors?.startsAt}
          >
            <Input
              id="shift-start"
              name="startsAt"
              type="datetime-local"
              required
              defaultValue={v?.startsAt ?? `${defaultDate}T09:00`}
            />
          </Field>

          <Field
            label="Finishes"
            htmlFor="shift-end"
            error={state.fieldErrors?.endsAt}
            hint="For an overnight shift, choose the next day."
          >
            <Input
              id="shift-end"
              name="endsAt"
              type="datetime-local"
              required
              defaultValue={v?.endsAt ?? `${defaultDate}T17:00`}
            />
          </Field>

          <Field
            label="Unpaid break (minutes)"
            htmlFor="shift-break"
          >
            <Input
              id="shift-break"
              name="breakMinutes"
              type="number"
              min={0}
              max={600}
              step={5}
              defaultValue={v?.breakMinutes || 30}
            />
          </Field>

          <Field
            label="Required role or skill"
            htmlFor="shift-role"
            hint="Shown on open shifts so staff know what is needed."
          >
            <Input
              id="shift-role"
              name="requiredRole"
              defaultValue={v?.requiredRole ?? ""}
              maxLength={100}
              placeholder="Night reception"
            />
          </Field>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="shift-notes">Notes for staff</Label>
          <textarea
            id="shift-notes"
            name="notes"
            rows={2}
            defaultValue={v?.notes ?? ""}
            maxLength={1000}
            placeholder="Conference checkout — start on the top floor."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        {state.conflicts && state.conflicts.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Before you roster this
            </p>
            <ConflictList conflicts={state.conflicts} />
          </div>
        )}

        {state.needsOverride && (
          <Field
            label="Reason for rostering anyway"
            htmlFor="shift-override"
            hint="Recorded against the shift and visible in the audit log."
            error={state.fieldErrors?.overrideReason}
          >
            <Input
              id="shift-override"
              name="overrideReason"
              required
              maxLength={500}
              placeholder="Aroha offered to cover; leave was cancelled."
            />
          </Field>
        )}

        {state.error && !state.needsOverride && (
          <Alert tone="error">{state.error}</Alert>
        )}

        <div className="flex gap-2">
          <SubmitButton needsOverride={Boolean(state.needsOverride)} />
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </form>
    </section>
  );
}
