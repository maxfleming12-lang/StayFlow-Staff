"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  decideReplacement,
  offerReplacement,
  type ReplacementActionState,
} from "@/lib/replacements/actions";

function Pending({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * Manager controls for one replacement request.
 *
 * Which controls appear depends on where the request is in its state
 * machine — offering a shift that has already been claimed, or approving one
 * nobody has claimed, are both meaningless and simply not shown.
 */
export function ReplacementDecision({
  requestId,
  status,
  claimantName,
}: {
  requestId: string;
  status: string;
  claimantName: string | null;
}) {
  const [showNote, setShowNote] = useState(false);
  const [offerState, offerAction] = useActionState<
    ReplacementActionState,
    FormData
  >(offerReplacement, {});
  const [decideState, decideAction] = useActionState<
    ReplacementActionState,
    FormData
  >(decideReplacement, {});

  const settled = offerState.success ?? decideState.success;
  if (settled) return <Alert tone="success">{settled}</Alert>;

  const error = offerState.error ?? decideState.error;

  return (
    <div className="space-y-3">
      {error && <Alert tone="error">{error}</Alert>}

      {status === "requested" && (
        <form action={offerAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="id" value={requestId} />
          <Pending label="Offer to all eligible staff" />
        </form>
      )}

      {status === "claimed" && claimantName && (
        <p className="text-sm text-slate-700 dark:text-slate-300">
          <strong>{claimantName}</strong> has asked to take this shift.
        </p>
      )}

      <form action={decideAction} className="space-y-3">
        <input type="hidden" name="id" value={requestId} />

        {showNote && (
          <Field label="Note for the staff member" htmlFor={`rn-${requestId}`}>
            <Input id={`rn-${requestId}`} name="managerNote" maxLength={500} />
          </Field>
        )}

        <div className="flex flex-wrap gap-2">
          {status === "claimed" && (
            <Button type="submit" name="decision" value="approved" size="sm">
              Approve and reassign
            </Button>
          )}
          <Button
            type="submit"
            name="decision"
            value="rejected"
            size="sm"
            variant="outline"
          >
            Decline request
          </Button>
          {!showNote && (
            <Button variant="ghost" size="sm" onClick={() => setShowNote(true)}>
              Add a note
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
