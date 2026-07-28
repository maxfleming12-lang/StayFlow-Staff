"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Delete } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { kioskPunch, type KioskActionState } from "@/lib/kiosk/actions";

/**
 * PIN-first shared kiosk.
 *
 * Six digits identify the staff member and toggle their clock state: the
 * first entry clocks in and the next clocks out. No staff directory or
 * employment detail is exposed on the shared tablet.
 */
export function KioskClock({ propertyName }: { propertyName: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dismissedOutcome, setDismissedOutcome] = useState(false);
  const [state, formAction] = useActionState<KioskActionState, FormData>(
    kioskPunch,
    {},
  );

  useEffect(() => {
    if (!state.success && !state.error) return;
    const readyId = setTimeout(() => {
      setSubmitting(false);
      setDismissedOutcome(false);
    }, 0);
    const resetId = setTimeout(() => {
      setPin("");
      setSubmitting(false);
      setDismissedOutcome(true);
    }, 10_000);
    return () => {
      clearTimeout(readyId);
      clearTimeout(resetId);
    };
  }, [state]);

  const showOutcome =
    !submitting &&
    !dismissedOutcome &&
    Boolean(state.success || state.error);

  if (showOutcome) {
    return (
      <div className="space-y-4 text-center">
        <Alert tone={state.success ? "success" : "error"}>
          {state.success ?? state.error}
        </Alert>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Returning to the keypad in 10 seconds…
        </p>
        <button
          type="button"
          onClick={() => {
            setPin("");
            setSubmitting(false);
            setDismissedOutcome(true);
          }}
          className="text-sm font-medium text-teal-700 underline dark:text-teal-400"
        >
          Next person
        </button>
      </div>
    );
  }

  const press = (digit: string) => {
    if (submitting) return;
    const next = (pin + digit).slice(0, 6);
    setPin(next);
    if (next.length === 6) {
      setSubmitting(true);
      setDismissedOutcome(true);
      queueMicrotask(() => formRef.current?.requestSubmit());
    }
  };

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <input type="hidden" name="pin" value={pin} />

      <div className="text-center">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Enter your 6-digit staff code
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {propertyName}
        </p>
      </div>

      <p
        className="min-h-10 text-center text-3xl tracking-[0.45em] text-slate-900 dark:text-slate-50"
        aria-live="polite"
        aria-label={`${pin.length} of 6 digits entered`}
      >
        {"•".repeat(pin.length) || <span className="opacity-30">••••••</span>}
      </p>

      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button
            key={digit}
            type="button"
            disabled={submitting}
            onClick={() => press(digit)}
            className="h-20 rounded-xl border border-slate-300 bg-white text-2xl font-semibold text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          disabled={submitting}
          onClick={() => setPin("")}
          className="h-20 rounded-xl border border-slate-300 text-sm text-slate-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400"
        >
          Clear
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => press("0")}
          className="h-20 rounded-xl border border-slate-300 bg-white text-2xl font-semibold text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          0
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => setPin((current) => current.slice(0, -1))}
          aria-label="Delete last digit"
          className="flex h-20 items-center justify-center rounded-xl border border-slate-300 text-slate-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400"
        >
          <Delete className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>

      {submitting && (
        <p className="text-center text-sm text-slate-500" aria-live="polite">
          Checking…
        </p>
      )}
    </form>
  );
}
