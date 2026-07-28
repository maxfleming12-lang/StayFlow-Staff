"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { decideLeave, type LeaveActionState } from "@/lib/leave/actions";

function DecisionButton({
  decision,
  hasConflicts,
}: {
  decision: "approved" | "declined";
  hasConflicts: boolean;
}) {
  const { pending } = useFormStatus();
  const approving = decision === "approved";
  return (
    <Button
      type="submit"
      name="decision"
      value={decision}
      size="sm"
      variant={approving ? "primary" : "outline"}
      disabled={pending}
      aria-busy={pending}
    >
      {pending
        ? "Saving…"
        : approving
          ? hasConflicts
            ? "Approve despite conflicts"
            : "Approve"
          : "Decline"}
    </Button>
  );
}

/**
 * Approve or decline controls for one leave request.
 *
 * The manager note is always available rather than only on decline: a
 * conditional approval ("approved, but you are covering Saturday") is as
 * useful as a reason for refusal.
 */
export function LeaveDecision({
  requestId,
  hasConflicts,
}: {
  requestId: string;
  hasConflicts: boolean;
}) {
  const [showNote, setShowNote] = useState(false);
  const [state, formAction] = useActionState<LeaveActionState, FormData>(
    decideLeave,
    {},
  );

  if (state.success) {
    return <Alert tone="success">{state.success}</Alert>;
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={requestId} />

      {state.error && <Alert tone="error">{state.error}</Alert>}

      {showNote && (
        <Field label="Note for the staff member" htmlFor={`note-${requestId}`}>
          <Input
            id={`note-${requestId}`}
            name="managerNote"
            maxLength={1000}
            placeholder="Approved — Liam is covering your Saturday shift."
          />
        </Field>
      )}

      <div className="flex flex-wrap gap-2">
        <DecisionButton decision="approved" hasConflicts={hasConflicts} />
        <DecisionButton decision="declined" hasConflicts={false} />
        {!showNote && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowNote(true)}
          >
            Add a note
          </Button>
        )}
      </div>
    </form>
  );
}
