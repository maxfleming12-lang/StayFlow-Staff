"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  requestReplacement,
  withdrawReplacement,
  type ReplacementActionState,
} from "@/lib/replacements/actions";
import { REPLACEMENT_STATUS_LABEL } from "@/lib/replacements/eligibility";

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending} aria-busy={pending}>
      {pending ? "Sending…" : "Send request"}
    </Button>
  );
}

/**
 * Ask to be replaced on a shift, from the staff roster.
 *
 * The shift is never removed from view while this is in flight — asking for
 * cover does not mean the shift stops being theirs, so the card keeps
 * showing it exactly as before, with the request's status alongside.
 */
export function RequestReplacement({
  shiftId,
  activeReplacement,
}: {
  shiftId: string;
  activeReplacement: { id: string; status: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const [pendingWithdraw, setPendingWithdraw] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<string | null>(null);
  const [state, formAction] = useActionState<ReplacementActionState, FormData>(
    requestReplacement,
    {},
  );

  if (withdrawResult) return <Alert tone="success">{withdrawResult}</Alert>;

  if (activeReplacement) {
    const { id: requestId, status } = activeReplacement;
    return (
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
        <span className="text-slate-600 dark:text-slate-400">
          Replacement: {REPLACEMENT_STATUS_LABEL[status] ?? status}
        </span>
        {(status === "requested" || status === "offered") && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pendingWithdraw}
            onClick={async () => {
              setPendingWithdraw(true);
              const r = await withdrawReplacement(requestId);
              setPendingWithdraw(false);
              if (r.success) setWithdrawResult(r.success);
            }}
          >
            Withdraw
          </Button>
        )}
      </div>
    );
  }

  if (state.success) {
    return (
      <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
        <Alert tone="success">{state.success}</Alert>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Ask to be replaced
        </Button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="mt-3 space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800"
    >
      <input type="hidden" name="shiftId" value={shiftId} />

      {state.error && <Alert tone="error">{state.error}</Alert>}

      <Field
        label="Why can you not work this shift?"
        htmlFor={`replace-reason-${shiftId}`}
        hint="Your manager sees this. You stay rostered until they arrange cover."
      >
        <textarea
          id={`replace-reason-${shiftId}`}
          name="reason"
          rows={2}
          required
          minLength={5}
          maxLength={500}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </Field>

      <div className="flex gap-2">
        <SendButton />
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
