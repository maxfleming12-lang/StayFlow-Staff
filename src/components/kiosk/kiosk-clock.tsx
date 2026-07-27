"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Delete, UserRound } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { kioskPunch, type KioskActionState } from "@/lib/kiosk/actions";
import type { ClockEventType } from "@/lib/clock/state";

interface Staff {
  id: string;
  displayName: string;
  hasPin: boolean;
}

const ACTIONS: { value: ClockEventType; label: string }[] = [
  { value: "clock_in", label: "Clock in" },
  { value: "break_start", label: "Start break" },
  { value: "break_end", label: "End break" },
  { value: "clock_out", label: "Clock out" },
];

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      className="h-14 w-full text-base"
    >
      {pending ? "Checking…" : "Confirm"}
    </Button>
  );
}

/**
 * Kiosk clock for a shared tablet.
 *
 * Deliberately returns to the staff list after every action, successful or
 * not. A kiosk left showing the previous person's name is how somebody
 * clocks out the wrong colleague, and how a queue at shift change turns
 * into an argument about whose hours are whose.
 */
export function KioskClock({
  staff,
  propertyName,
}: {
  staff: Staff[];
  propertyName: string;
}) {
  const [selected, setSelected] = useState<Staff | null>(null);
  const [action, setAction] = useState<ClockEventType>("clock_in");
  const [pin, setPin] = useState("");
  const [state, formAction] = useActionState<KioskActionState, FormData>(
    kioskPunch,
    {},
  );

  // Clear the screen after any outcome, so the next person starts fresh and
  // no PIN or name is left on display.
  useEffect(() => {
    if (!state.success && !state.error) return;
    const id = setTimeout(() => {
      setSelected(null);
      setPin("");
      setAction("clock_in");
    }, 4000);
    return () => clearTimeout(id);
  }, [state]);

  if (state.success || state.error) {
    return (
      <div className="space-y-4 text-center">
        <Alert tone={state.success ? "success" : "error"}>
          {state.success ?? state.error}
        </Alert>
        <Button
          variant="outline"
          onClick={() => {
            setSelected(null);
            setPin("");
          }}
        >
          Done
        </Button>
      </div>
    );
  }

  if (!selected) {
    return (
      <div>
        <h2 className="text-center text-sm font-medium text-slate-500 dark:text-slate-400">
          {propertyName} — tap your name
        </h2>
        {staff.length === 0 ? (
          <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Nobody is set up to clock on at this property yet.
          </p>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-3">
            {staff.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => setSelected(person)}
                  disabled={!person.hasPin}
                  className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded-xl border border-slate-300 bg-white text-base font-medium text-slate-900 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <UserRound className="h-5 w-5" aria-hidden="true" />
                  {person.displayName}
                  {!person.hasPin && (
                    <span className="text-xs font-normal text-slate-500">
                      No PIN set
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const press = (digit: string) => setPin((p) => (p + digit).slice(0, 10));

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="userId" value={selected.id} />
      <input type="hidden" name="pin" value={pin} />
      <input type="hidden" name="eventType" value={action} />

      <div className="text-center">
        <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          {selected.displayName}
        </p>
        <button
          type="button"
          onClick={() => {
            setSelected(null);
            setPin("");
          }}
          className="text-sm text-teal-700 underline dark:text-teal-400"
        >
          Not you?
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {ACTIONS.map((a) => (
          <button
            key={a.value}
            type="button"
            onClick={() => setAction(a.value)}
            aria-pressed={action === a.value}
            className={`h-12 rounded-lg border text-sm font-medium ${
              action === a.value
                ? "border-teal-600 bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-300"
                : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div>
        <p
          className="text-center text-3xl tracking-[0.5em] text-slate-900 dark:text-slate-50"
          aria-live="polite"
          aria-label={`${pin.length} digits entered`}
        >
          {"•".repeat(pin.length) || <span className="opacity-30">····</span>}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => press(d)}
            className="h-16 rounded-lg border border-slate-300 text-xl font-medium text-slate-900 dark:border-slate-700 dark:text-slate-100"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPin("")}
          className="h-16 rounded-lg border border-slate-300 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => press("0")}
          className="h-16 rounded-lg border border-slate-300 text-xl font-medium text-slate-900 dark:border-slate-700 dark:text-slate-100"
        >
          0
        </button>
        <button
          type="button"
          onClick={() => setPin((p) => p.slice(0, -1))}
          aria-label="Delete last digit"
          className="flex h-16 items-center justify-center rounded-lg border border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400"
        >
          <Delete className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <SubmitButton disabled={pin.length < 4} />
    </form>
  );
}
