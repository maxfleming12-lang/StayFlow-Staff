"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Megaphone } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/field";
import {
  createAnnouncement,
  type AnnouncementActionState,
} from "@/lib/announcements/actions";
import { ANNOUNCEMENT_CATEGORIES } from "@/lib/announcements/status";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? "Posting…" : "Post notice"}
    </Button>
  );
}

const SELECT_CLASS =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

/** Write and post a notice. */
export function AnnouncementForm({
  properties,
}: {
  properties: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState("all");
  const [state, action] = useActionState<AnnouncementActionState, FormData>(
    createAnnouncement,
    {},
  );

  const v = state.values;

  if (!open) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        {state.success && (
          <div className="mb-3">
            <Alert tone="success">{state.success}</Alert>
          </div>
        )}
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Megaphone className="h-4 w-4" aria-hidden="true" />
          Post a notice
        </Button>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="announcement-form-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2
        id="announcement-form-heading"
        className="text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        Post a notice
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        It goes out as soon as you post it. You can withdraw it later, and
        what you said stays on the record.
      </p>

      {state.success && (
        <div className="mt-3">
          <Alert tone="success">{state.success}</Alert>
        </div>
      )}

      <form action={action} className="mt-4 space-y-4">
        <Field label="Title" htmlFor="ann-title" error={state.fieldErrors?.title}>
          <Input
            id="ann-title"
            name="title"
            required
            maxLength={200}
            defaultValue={v?.title ?? ""}
            placeholder="Fire drill on Thursday"
          />
        </Field>

        <div className="space-y-1.5">
          <Label htmlFor="ann-body">Notice</Label>
          <textarea
            id="ann-body"
            name="body"
            rows={4}
            required
            maxLength={5000}
            defaultValue={v?.body ?? ""}
            placeholder="There will be a fire drill at 10am on Thursday. Please make sure all guests in your area are accounted for."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          {state.fieldErrors?.body && (
            <p className="text-sm text-red-700 dark:text-red-400">
              {state.fieldErrors.body}
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="ann-category">
            <select
              id="ann-category"
              name="category"
              defaultValue={v?.category ?? "general"}
              className={SELECT_CLASS}
            >
              {ANNOUNCEMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Who sees it" htmlFor="ann-audience">
            <select
              id="ann-audience"
              name="audience"
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              className={SELECT_CLASS}
            >
              <option value="all">All staff</option>
              <option value="property">One property</option>
            </select>
          </Field>

          {audience === "property" && (
            <Field
              label="Property"
              htmlFor="ann-property"
              error={state.fieldErrors?.propertyId}
            >
              <select
                id="ann-property"
                name="propertyId"
                defaultValue={v?.propertyId ?? properties[0]?.id}
                className={SELECT_CLASS}
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field
            label="Stops applying"
            htmlFor="ann-expires"
            error={state.fieldErrors?.expiresAt}
            hint="Leave blank if it does not expire."
          >
            <Input
              id="ann-expires"
              name="expiresAt"
              type="datetime-local"
              defaultValue={v?.expiresAt ?? ""}
            />
          </Field>
        </div>

        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              name="requiresAck"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 dark:border-slate-600"
            />
            <span>Ask staff to confirm they have read it.</span>
          </label>

          <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              name="isUrgent"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-red-700 focus:ring-red-600 dark:border-slate-600"
            />
            <span>
              Urgent — this will reach people during their quiet hours. Use it
              for something that genuinely cannot wait until morning.
            </span>
          </label>
        </div>

        {state.error && <Alert tone="error">{state.error}</Alert>}

        <div className="flex gap-2">
          <SubmitButton />
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </form>
    </section>
  );
}
