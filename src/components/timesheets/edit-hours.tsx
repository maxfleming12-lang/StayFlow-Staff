"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/field";
import {
  updateTimesheetHours,
  type TimesheetActionState,
} from "@/lib/timesheets/actions";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? "Saving…" : "Save hours"}
    </Button>
  );
}

/**
 * Correct the hours on a timesheet.
 *
 * Times are shown and entered as wall-clock at the property, which is how
 * the staff member worked them — the server resolves them against the
 * timesheet's own date.
 */
export function EditHours({
  timesheetId,
  startTime,
  endTime,
  breakMinutes,
  isApproved,
}: {
  timesheetId: string;
  /** Current start as local HH:mm, or "" when nothing was recorded. */
  startTime: string;
  endTime: string;
  breakMinutes: number;
  isApproved: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<TimesheetActionState, FormData>(
    updateTimesheetHours,
    {},
  );

  if (!open) {
    return (
      <div className="mt-2">
        {state.success && <Alert tone="success">{state.success}</Alert>}
        <Button
          variant="ghost"
          size="sm"
          className="mt-1"
          onClick={() => setOpen(true)}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Edit hours
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="mt-2 space-y-3">
      <input type="hidden" name="timesheetId" value={timesheetId} />

      {isApproved && (
        <Alert tone="warning">
          This timesheet is approved. Changing the hours clears the approval,
          so it will need approving again.
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Started"
          htmlFor={`eh-start-${timesheetId}`}
          error={state.fieldErrors?.startTime}
        >
          <Input
            id={`eh-start-${timesheetId}`}
            name="startTime"
            type="time"
            required
            step={300}
            defaultValue={startTime || "09:00"}
          />
        </Field>
        <Field
          label="Finished"
          htmlFor={`eh-end-${timesheetId}`}
          error={state.fieldErrors?.endTime}
          hint="Earlier than the start means it ran past midnight."
        >
          <Input
            id={`eh-end-${timesheetId}`}
            name="endTime"
            type="time"
            required
            step={300}
            defaultValue={endTime || "17:00"}
          />
        </Field>
        <Field
          label="Unpaid break (min)"
          htmlFor={`eh-break-${timesheetId}`}
          error={state.fieldErrors?.breakMinutes}
        >
          <Input
            id={`eh-break-${timesheetId}`}
            name="breakMinutes"
            type="number"
            min={0}
            max={600}
            step={5}
            defaultValue={String(breakMinutes)}
          />
        </Field>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`eh-note-${timesheetId}`}>Why it changed</Label>
        <textarea
          id={`eh-note-${timesheetId}`}
          name="managerNote"
          rows={2}
          maxLength={500}
          placeholder="Forgot to clock out — finish time confirmed with reception."
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Saved on the timesheet, where the staff member can see it. They are
          notified that their hours changed.
        </p>
      </div>

      {state.error && <Alert tone="error">{state.error}</Alert>}

      <div className="flex gap-2">
        <SaveButton />
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
