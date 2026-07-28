"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  decideAvailability,
  type AvailabilityActionState,
} from "@/lib/availability/actions";

function DecisionButton({ decision }: { decision: "approved" | "declined" }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="decision"
      value={decision}
      size="sm"
      variant={decision === "approved" ? "primary" : "outline"}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Saving…" : decision === "approved" ? "Approve" : "Decline"}
    </Button>
  );
}

/**
 * Approve or decline one availability submission.
 *
 * Approval is not bookkeeping: the roster conflict engine consults only
 * APPROVED availability, so leaving a submission pending means it warns
 * nobody when a clashing shift is created.
 */
export function AvailabilityDecision({ recordId }: { recordId: string }) {
  const [showNote, setShowNote] = useState(false);
  const [state, formAction] = useActionState<AvailabilityActionState, FormData>(
    decideAvailability,
    {},
  );

  if (state.success) return <Alert tone="success">{state.success}</Alert>;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={recordId} />

      {state.error && <Alert tone="error">{state.error}</Alert>}

      {showNote && (
        <Field label="Note for the staff member" htmlFor={`rn-${recordId}`}>
          <Input
            id={`rn-${recordId}`}
            name="reviewNote"
            maxLength={500}
            placeholder="Noted — we will avoid Wednesday mornings."
          />
        </Field>
      )}

      <div className="flex flex-wrap gap-2">
        <DecisionButton decision="approved" />
        <DecisionButton decision="declined" />
        {!showNote && (
          <Button variant="ghost" size="sm" onClick={() => setShowNote(true)}>
            Add a note
          </Button>
        )}
      </div>
    </form>
  );
}
