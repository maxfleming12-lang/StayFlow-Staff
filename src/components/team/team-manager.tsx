"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { UserPlus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  addBasicStaff,
  sendPasswordReset,
  setStaffActive,
  updateBasicStaff,
  type TeamActionState,
} from "@/lib/team/actions";
import type { TeamMember } from "@/lib/team/queries";
import { ROLE_LABEL } from "@/lib/auth/roles";
import type { Role } from "@/lib/auth/roles";

function SubmitButton({ label = "Add staff" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * Add and manage staff.
 *
 * Only administrators and owners see the controls — creating an account is
 * the one action in the app that grants somebody access to everything else.
 */
export function TeamManager({
  team,
  properties,
  canManage,
}: {
  team: TeamMember[];
  properties: { id: string; name: string }[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [state, formAction] = useActionState<TeamActionState, FormData>(
    addBasicStaff,
    {},
  );
  const [editState, editAction] = useActionState<TeamActionState, FormData>(
    updateBasicStaff,
    {},
  );

  const active = team.filter((m) => m.isActive);
  const inactive = team.filter((m) => !m.isActive);

  const run = (fn: () => Promise<TeamActionState>) =>
    startTransition(async () => {
      const result = await fn();
      setMessage(
        result.error
          ? { tone: "error", text: result.error }
          : { tone: "success", text: result.success ?? "Done." },
      );
    });

  const row = (member: TeamMember) => (
    <li
      key={member.id}
      className="border-b border-slate-100 py-3 last:border-0 dark:border-slate-800"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {member.displayName}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {ROLE_LABEL[member.role as Role] ?? member.role}
            {member.jobTitle && ` · ${member.jobTitle}`}
            {member.propertyNames.length > 0 &&
              ` · ${member.propertyNames.join(", ")}`}
          </p>
        </div>

        {canManage && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setEditingId(editingId === member.id ? null : member.id)
              }
            >
              Edit
            </Button>
            {!member.isKioskOnly && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => run(() => sendPasswordReset(member.email))}
              >
                Reset password
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => run(() => setStaffActive(member.id, !member.isActive))}
            >
              {member.isActive ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        )}
      </div>

      {editingId === member.id && (
        <form action={editAction} className="mt-4 space-y-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
          <input type="hidden" name="userId" value={member.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor={`edit-name-${member.id}`}>
              <Input
                id={`edit-name-${member.id}`}
                name="name"
                defaultValue={member.displayName}
                required
              />
            </Field>
            <Field label="Hired for" htmlFor={`edit-job-${member.id}`}>
              <Input
                id={`edit-job-${member.id}`}
                name="jobTitle"
                defaultValue={member.jobTitle ?? ""}
                required
              />
            </Field>
            <Field
              label="New 6-digit code"
              htmlFor={`edit-pin-${member.id}`}
              hint="Leave blank to keep the current code."
            >
              <Input
                id={`edit-pin-${member.id}`}
                name="pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                autoComplete="new-password"
              />
            </Field>
          </div>
          {editState.error && <Alert tone="error">{editState.error}</Alert>}
          {editState.success && (
            <Alert tone="success">{editState.success}</Alert>
          )}
          <div className="flex gap-2">
            <SubmitButton label="Save changes" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditingId(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </li>
  );

  return (
    <div className="space-y-5">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {canManage && state.success && <Alert tone="success">{state.success}</Alert>}

      {canManage && !open && (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Add someone
        </Button>
      )}

      {canManage && open && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Add someone
          </h2>

          {state.error && (
            <div className="mt-3">
              <Alert tone="error">{state.error}</Alert>
            </div>
          )}

          <form action={formAction} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="t-name">
                <Input
                  id="t-name"
                  name="name"
                  required
                  maxLength={150}
                  placeholder="Madison Sigman"
                />
              </Field>
              <Field
                label="What are they hired for?"
                htmlFor="t-title"
                hint="This automatically appears when you roster them."
              >
                <Input
                  id="t-title"
                  name="jobTitle"
                  required
                  maxLength={100}
                  placeholder="Housekeeping"
                />
              </Field>
              <Field
                label="6-digit staff code"
                htmlFor="t-pin"
                hint="They use this code only on the kiosk keypad."
              >
                <Input
                  id="t-pin"
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  required
                  autoComplete="new-password"
                />
              </Field>
            </div>

            <fieldset>
              <legend className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Properties they can work at
              </legend>
              <div className="mt-2 space-y-1.5">
                {properties.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300"
                  >
                    <input
                      type="checkbox"
                      name="propertyIds"
                      value={p.id}
                      defaultChecked
                      className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex gap-2">
              <SubmitButton />
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Team ({active.length})
        </h2>
        <ul className="mt-2">{active.map(row)}</ul>
      </section>

      {inactive.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            No longer active ({inactive.length})
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Their roster and hours are kept for your records.
          </p>
          <ul className="mt-2 opacity-70">{inactive.map(row)}</ul>
        </section>
      )}
    </div>
  );
}
