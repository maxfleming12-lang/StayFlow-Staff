"use client";

import { useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  generateCalendarToken,
  revokeCalendarToken,
} from "@/lib/calendar/actions";

/**
 * Calendar subscription controls.
 *
 * The URL is treated as what it is — a password in a link. Anyone holding it
 * can read this person's roster without signing in, which is exactly how
 * calendar subscriptions have to work, so the screen says so plainly rather
 * than presenting it as an innocuous share link.
 */
export function CalendarSubscription({
  token,
  siteUrl,
}: {
  token: string | null;
  siteUrl: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const url = token ? `${siteUrl}/api/calendar/${token}` : null;

  const run = (action: () => Promise<{ error?: string; success?: string }>) => {
    startTransition(async () => {
      const result = await action();
      setMessage(
        result.error
          ? { tone: "error", text: result.error }
          : { tone: "success", text: result.success ?? "Done." },
      );
    });
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage({
        tone: "error",
        text: "Could not copy automatically. Select the link and copy it manually.",
      });
    }
  };

  return (
    <section
      aria-labelledby="calendar-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2
        id="calendar-heading"
        className="text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        Add your roster to your calendar
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Subscribe in Apple Calendar, Google Calendar or Outlook to see your
        published shifts alongside everything else.
      </p>

      {message && (
        <div className="mt-3">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      )}

      {url ? (
        <>
          <div className="mt-4 space-y-2">
            <label
              htmlFor="calendar-url"
              className="text-xs font-medium text-slate-500 dark:text-slate-400"
            >
              Your private calendar link
            </label>
            <div className="flex gap-2">
              <input
                id="calendar-url"
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              />
              <Button variant="outline" size="sm" onClick={copy}>
                {copied ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden="true" />
                )}
                <span className="sr-only sm:not-sr-only">
                  {copied ? "Copied" : "Copy"}
                </span>
              </Button>
            </div>
          </div>

          <Alert tone="warning" className="mt-3">
            Treat this link like a password. Anyone who has it can see your
            roster without signing in. If you share it by mistake, revoke it
            and create a new one.
          </Alert>

          <details className="mt-3 text-sm text-slate-600 dark:text-slate-400">
            <summary className="cursor-pointer font-medium text-slate-900 dark:text-slate-100">
              How to subscribe
            </summary>
            <div className="mt-2 space-y-2">
              <p>
                <strong>iPhone or iPad:</strong> Settings → Calendar → Accounts
                → Add Account → Other → Add Subscribed Calendar, then paste the
                link.
              </p>
              <p>
                <strong>Google Calendar:</strong> on a computer, Other calendars
                → + → From URL, then paste the link.
              </p>
              <p>
                <strong>Outlook:</strong> Add calendar → Subscribe from web,
                then paste the link.
              </p>
              <p className="text-xs">
                Calendars refresh on their own schedule, often every few hours,
                so a newly published shift may take a little while to appear.
              </p>
            </div>
          </details>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => run(generateCalendarToken)}
            >
              {pending ? "Working…" : "Replace with a new link"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => run(revokeCalendarToken)}
            >
              Revoke
            </Button>
          </div>
        </>
      ) : (
        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(generateCalendarToken)}
          >
            {pending ? "Creating…" : "Create calendar link"}
          </Button>
        </div>
      )}
    </section>
  );
}
