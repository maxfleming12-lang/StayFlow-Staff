"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Check, Copy, UserPlus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  inviteStaff,
  sendPasswordReset,
  setStaffActive,
  type TeamActionState,
} from "@/lib/team/actions";
import type { TeamMember } from "@/lib/team/queries";
import { ROLE_LABEL } from "@/lib/auth/roles";
import type { Role } from "@/lib/auth/roles";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Creating…" : "Create account"}
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
  const [copied, setCopied] = useState(false);
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [state, formAction] = useActionState<TeamActionState, FormData>(
    inviteStaff,
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

  const copyPassword = async () => {
    if (!state.temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(state.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The password is on screen regardless; copying is a convenience.
    }
  };

  const row = (member: TeamMember) => (
    <li
      key={member.id}
      className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0 dark:border-slate-800"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
          {member.displayName}
          {member.displayName !== member.fullName && (
            <span className="font-normal text-slate-500"> ({member.fullName})</span>
          )}
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
            disabled={busy}
            onClick={() => run(() => sendPasswordReset(member.email))}
          >
            Reset password
          </Button>
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
    </li>
  );

  return (
    <div className="space-y-5">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {canManage && state.temporaryPassword && (
        <Alert tone="warning" title="Give them this password now">
          <span className="mt-1 block font-mono text-base">
            {state.temporaryPassword}
          </span>
          <span className="mt-2 block text-xs">
            It is shown once and cannot be looked up again. Tell them in
            person — they can change it from the sign-in screen using
            &ldquo;Forgotten your password&rdquo;.
          </span>
          <span className="mt-2 block">
            <Button variant="outline" size="sm" onClick={copyPassword}>
              {copied ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </span>
        </Alert>
      )}

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
              <Field label="First name" htmlFor="t-first">
                <Input id="t-first" name="firstName" required maxLength={100} />
              </Field>
              <Field label="Last name" htmlFor="t-last">
                <Input id="t-last" name="lastName" required maxLength={100} />
              </Field>
              <Field
                label="Preferred name"
                htmlFor="t-preferred"
                hint="What everyone actually calls them."
              >
                <Input id="t-preferred" name="preferredName" maxLength={100} />
              </Field>
              <Field label="Job title" htmlFor="t-title">
                <Input
                  id="t-title"
                  name="jobTitle"
                  maxLength={100}
                  placeholder="Room Attendant"
                />
              </Field>
              <Field label="Email" htmlFor="t-email" hint="They sign in with this.">
                <Input id="t-email" name="email" type="email" required />
              </Field>
              <Field label="Mobile" htmlFor="t-mobile">
                <Input id="t-mobile" name="mobile" type="tel" maxLength={30} />
              </Field>
            </div>

            <Field label="Role" htmlFor="t-role">
              <select
                id="t-role"
                name="role"
                required
                defaultValue="staff"
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="staff">Staff</option>
                <option value="supervisor">Supervisor</option>
                <option value="manager">Manager</option>
                <option value="administrator">Administrator</option>
              </select>
            </Field>

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
