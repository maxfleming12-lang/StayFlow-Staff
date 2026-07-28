"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { acceptShift, declineShift, type AckState } from "@/lib/roster/actions";

function PendingButton({
  children,
  variant,
}: {
  children: string;
  variant?: "primary" | "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={variant}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Saving…" : children}
    </Button>
  );
}

/**
 * Accept or decline controls for a shift requiring acknowledgement.
 *
 * Declining opens a reason field first. The reason is mandatory because the
 * decline does not remove the shift — it becomes a manager review item, and
 * a manager needs to know why in order to arrange cover.
 */
export function ShiftResponse({ shiftId }: { shiftId: string }) {
  const [showDecline, setShowDecline] = useState(false);
  const [acceptState, acceptAction] = useActionState<AckState, FormData>(
    acceptShift,
    {},
  );
  const [declineState, declineAction] = useActionState<AckState, FormData>(
    declineShift,
    {},
  );

  const settled = acceptState.success ?? declineState.success;
  if (settled) {
    return (
      <div className="mt-4">
        <Alert tone="success">{settled}</Alert>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
      {acceptState.error && (
        <Alert tone="error" className="mb-3">
          {acceptState.error}
        </Alert>
      )}

      {!showDecline ? (
        <div className="flex gap-2">
          <form action={acceptAction}>
            <input type="hidden" name="shiftId" value={shiftId} />
            <PendingButton>Accept shift</PendingButton>
          </form>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowDecline(true)}
          >
            Decline
          </Button>
        </div>
      ) : (
        <form action={declineAction} className="space-y-3">
          <input type="hidden" name="shiftId" value={shiftId} />

          {declineState.error && (
            <Alert tone="error">{declineState.error}</Alert>
          )}

          <Field
            label="Why can you not work this shift?"
            htmlFor={`reason-${shiftId}`}
            hint="Your manager sees this and will arrange cover. The shift stays on your roster until they do."
          >
            <textarea
              id={`reason-${shiftId}`}
              name="reason"
              rows={3}
              required
              minLength={5}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </Field>

          <div className="flex gap-2">
            <PendingButton variant="outline">Send decline</PendingButton>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowDecline(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
