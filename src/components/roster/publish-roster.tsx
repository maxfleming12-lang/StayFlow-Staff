"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  publishRoster,
  type RosterActionState,
} from "@/lib/roster/manager-actions";
import type { RosterProperty } from "@/lib/roster/manager-queries";
import { formatDateTime } from "@/lib/format";

function SubmitButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || count === 0} aria-busy={pending}>
      {pending
        ? "Publishing…"
        : `Publish ${count} shift${count === 1 ? "" : "s"}`}
    </Button>
  );
}

/**
 * Publish the week's draft shifts for one property.
 *
 * Publishing is deliberately per property: the two motels are rostered by
 * different people on different days, and a single "publish everything"
 * button would let one manager release the other's unfinished draft.
 */
export function PublishRoster({
  weekStartDate,
  properties,
  periods,
  draftCount,
}: {
  weekStartDate: string;
  properties: RosterProperty[];
  periods: { id: string; propertyId: string; status: string; publishedAt: string | null }[];
  draftCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<RosterActionState, FormData>(
    publishRoster,
    {},
  );

  const publishedFor = new Map(
    periods.map((p) => [p.propertyId, p.publishedAt]),
  );

  return (
    <section
      aria-labelledby="publish-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2
        id="publish-heading"
        className="text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        Publishing
      </h2>

      <ul className="mt-3 space-y-1.5 text-sm">
        {properties.map((p) => {
          const at = publishedFor.get(p.id);
          return (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 text-slate-600 dark:text-slate-400"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: p.colour ?? "#0f766e" }}
                />
                {p.name}
              </span>
              <span className="text-xs">
                {at ? `Published ${formatDateTime(at)}` : "Not published"}
              </span>
            </li>
          );
        })}
      </ul>

      {state.success && (
        <div className="mt-3">
          <Alert tone="success">{state.success}</Alert>
        </div>
      )}
      {state.error && (
        <div className="mt-3">
          <Alert tone="error">{state.error}</Alert>
        </div>
      )}

      {!open ? (
        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            disabled={draftCount === 0}
          >
            {draftCount === 0
              ? "No draft shifts to publish"
              : `Publish ${draftCount} draft shift${draftCount === 1 ? "" : "s"}…`}
          </Button>
        </div>
      ) : (
        <form action={formAction} className="mt-4 space-y-4">
          <input type="hidden" name="weekStartDate" value={weekStartDate} />

          <Field label="Property" htmlFor="publish-property">
            <select
              id="publish-property"
              name="propertyId"
              required
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Message to staff (optional)"
            htmlFor="publish-message"
            hint="Included in the notification, so keep it free of private detail — it can appear on a lock screen."
          >
            <Input
              id="publish-message"
              name="message"
              maxLength={500}
              placeholder="Busy weekend — please check your start times."
            />
          </Field>

          <label className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              name="requireAck"
              defaultChecked
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
            />
            <span>
              Require staff to accept or decline each shift
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                You will see who has viewed, accepted, declined or not
                responded.
              </span>
            </span>
          </label>

          <div className="flex gap-2">
            <SubmitButton count={draftCount} />
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
