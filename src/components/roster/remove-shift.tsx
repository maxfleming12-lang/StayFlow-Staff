"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  removeShift,
  type RosterActionState,
} from "@/lib/roster/manager-actions";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="danger"
      size="sm"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Removing…" : "Yes, remove"}
    </Button>
  );
}

/**
 * Remove one shift from the roster.
 *
 * Two-step rather than a single click. These controls sit on small cards and
 * inside narrow grid cells where a mis-tap is easy, and each shift is
 * identified only by a line of text — so the confirmation repeats what is
 * about to go, and says who it affects.
 *
 * `window.confirm` is avoided deliberately: it is suppressed in some
 * installed-PWA contexts, which is exactly how this app is used on the floor.
 */
export function RemoveShift({
  shiftId,
  label,
  consequence,
  compact = false,
}: {
  shiftId: string;
  /** Human description of the shift, e.g. "Tue 4 · 9:00am–5:00pm". */
  label: string;
  /** One sentence on who, if anyone, is affected. */
  consequence: string;
  /** Tighter styling for use inside a roster grid cell. */
  compact?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action] = useActionState<RosterActionState, FormData>(
    removeShift,
    {},
  );

  // The shift disappears on success, so this only shows in the moment before
  // the revalidated roster arrives.
  if (state.success) {
    return (
      <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
        {state.success}
      </p>
    );
  }

  if (!confirming) {
    return (
      <div className={compact ? "mt-1" : "mt-2"}>
        {state.error && <Alert tone="error">{state.error}</Alert>}
        <Button
          variant="ghost"
          size="sm"
          className={
            compact
              ? "h-7 px-1.5 text-[11px] text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
              : "mt-1 text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
          }
          onClick={() => setConfirming(true)}
        >
          <Trash2
            className={compact ? "h-3.5 w-3.5" : "h-4 w-4"}
            aria-hidden="true"
          />
          Remove
          <span className="sr-only"> the shift on {label}</span>
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className={compact ? "mt-1 space-y-1.5" : "mt-2 space-y-2"}>
      <input type="hidden" name="shiftId" value={shiftId} />
      <Alert tone="warning">
        Remove <strong>{label}</strong>? {consequence}
      </Alert>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <ConfirmButton />
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
