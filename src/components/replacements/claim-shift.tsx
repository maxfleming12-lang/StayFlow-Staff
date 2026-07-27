"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { claimShift } from "@/lib/replacements/actions";

/**
 * Claim control for an available shift.
 *
 * The button says "Ask for this shift" rather than "Take this shift",
 * because a claim is provisional until a manager approves it. Wording it as
 * a decision would leave someone believing they were rostered when they
 * were not.
 */
export function ClaimShift({
  offerId,
  alreadyClaimed,
}: {
  offerId: string | null;
  alreadyClaimed: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  if (result) return <Alert tone={result.tone}>{result.text}</Alert>;

  if (alreadyClaimed) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        You have asked for this shift. Waiting on your manager.
      </p>
    );
  }

  if (!offerId) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Speak to your manager if you can cover this.
      </p>
    );
  }

  return (
    <Button
      size="sm"
      disabled={pending}
      aria-busy={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await claimShift(offerId);
          setResult(
            r.error
              ? { tone: "error", text: r.error }
              : { tone: "success", text: r.success ?? "Done." },
          );
        })
      }
    >
      {pending ? "Sending…" : "Ask for this shift"}
    </Button>
  );
}
