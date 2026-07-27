"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  authoriseKiosk,
  revokeKiosk,
  setStaffPin,
  type KioskActionState,
} from "@/lib/kiosk/actions";
import { formatDateTime } from "@/lib/format";

function Pending({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

/** Authorise tablets, revoke them, and set staff PINs. */
export function KioskAdmin({
  properties,
  devices,
  staff,
}: {
  properties: { id: string; name: string }[];
  devices: {
    id: string;
    label: string | null;
    propertyName: string;
    expiresAt: string;
    lastUsedAt: string | null;
  }[];
  staff: { id: string; displayName: string; hasPin: boolean }[];
}) {
  const [authState, authAction] = useActionState<KioskActionState, FormData>(
    authoriseKiosk,
    {},
  );
  const [pinState, pinAction] = useActionState<KioskActionState, FormData>(
    setStaffPin,
    {},
  );
  const [pendingRevoke, startRevoke] = useTransition();
  const [revokeMessage, setRevokeMessage] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Authorise a tablet
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Open the link on the tablet itself. It is shown once and cannot be
          looked up again.
        </p>

        {authState.error && (
          <div className="mt-3">
            <Alert tone="error">{authState.error}</Alert>
          </div>
        )}

        {authState.kioskUrl && (
          <div className="mt-3 space-y-2">
            <Alert tone="success">{authState.success}</Alert>
            <Alert tone="warning" title="Open this on the tablet now">
              <span className="block break-all font-mono text-xs">
                {authState.kioskUrl}
              </span>
              Anyone with this link can reach the kiosk for that property, so
              do not send it by email or message.
            </Alert>
          </div>
        )}

        <form action={authAction} className="mt-4 space-y-4">
          <Field label="Property" htmlFor="kiosk-property">
            <select
              id="kiosk-property"
              name="propertyId"
              required
              defaultValue={properties[0]?.id}
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
            label="Label for this tablet"
            htmlFor="kiosk-label"
            hint="So you can tell devices apart when revoking one."
          >
            <Input
              id="kiosk-label"
              name="deviceLabel"
              maxLength={100}
              placeholder="Front desk iPad"
            />
          </Field>

          <Field label="Expires after (days)" htmlFor="kiosk-days">
            <Input
              id="kiosk-days"
              name="days"
              type="number"
              min={1}
              max={365}
              defaultValue={90}
            />
          </Field>

          <Pending label="Authorise" />
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Authorised tablets
        </h2>

        {revokeMessage && (
          <div className="mt-3">
            <Alert tone="success">{revokeMessage}</Alert>
          </div>
        )}

        {devices.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            No tablets are authorised.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {devices.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {d.label ?? "Unlabelled tablet"}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {d.propertyName} · expires {formatDateTime(d.expiresAt)}
                    {d.lastUsedAt
                      ? ` · last used ${formatDateTime(d.lastUsedAt)}`
                      : " · never used"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pendingRevoke}
                  onClick={() =>
                    startRevoke(async () => {
                      const r = await revokeKiosk(d.id);
                      if (r.success) setRevokeMessage(r.success);
                    })
                  }
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Staff PINs
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          A PIN lets someone clock on at a kiosk. It does not sign them in and
          gives no access to anything else.
        </p>

        {pinState.error && (
          <div className="mt-3">
            <Alert tone="error">{pinState.error}</Alert>
          </div>
        )}
        {pinState.success && (
          <div className="mt-3">
            <Alert tone="success">{pinState.success}</Alert>
          </div>
        )}

        <form action={pinAction} className="mt-4 space-y-4">
          <Field label="Staff member" htmlFor="pin-user">
            <select
              id="pin-user"
              name="userId"
              required
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                  {s.hasPin ? " (has a PIN)" : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="New PIN"
            htmlFor="pin-value"
            hint="4 to 10 digits. Tell them in person — it cannot be looked up afterwards."
          >
            <Input
              id="pin-value"
              name="pin"
              inputMode="numeric"
              pattern="[0-9]{4,10}"
              required
              autoComplete="off"
            />
          </Field>

          <Pending label="Set PIN" />
        </form>
      </section>
    </div>
  );
}
