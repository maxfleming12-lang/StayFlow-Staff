"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  assignOpenShift,
  type RosterActionState,
} from "@/lib/roster/manager-actions";
import type { RosterStaff } from "@/lib/roster/manager-queries";

function AssignButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? "Assigning…" : "Assign"}
    </Button>
  );
}

export function AssignOpenShift({
  shiftId,
  staff,
}: {
  shiftId: string;
  staff: RosterStaff[];
}) {
  const [state, action] = useActionState<RosterActionState, FormData>(
    assignOpenShift,
    {},
  );

  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="shiftId" value={shiftId} />
      <div className="flex gap-2">
        <select
          name="userId"
          required
          aria-label="Staff member"
          defaultValue=""
          className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="" disabled>
            Choose staff…
          </option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.displayName}
            </option>
          ))}
        </select>
        <AssignButton />
      </div>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.success && <Alert tone="success">{state.success}</Alert>}
    </form>
  );
}
