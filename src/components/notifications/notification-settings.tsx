"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  removePushSubscription,
  savePushSubscription,
  saveNotificationPreferences,
  type NotificationSettingsState,
} from "@/lib/notifications/actions";
import { CATEGORY_LABELS, isUrgent } from "@/lib/notifications/policy";

/**
 * base64url VAPID key to the buffer the Push API wants.
 *
 * Built on an explicit ArrayBuffer rather than Uint8Array.from, because the
 * Push API's type requires a plain ArrayBuffer and the generic form can be
 * backed by a SharedArrayBuffer.
 */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buffer;
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? "Saving…" : "Save settings"}
    </Button>
  );
}

/**
 * Notification settings.
 *
 * Two separate things, deliberately not merged: whether THIS DEVICE receives
 * push at all (a browser permission plus a subscription), and which
 * categories are worth interrupting you for (an account-wide preference).
 * Someone with a phone and a tablet wants the second shared and the first
 * per device.
 */
export function NotificationSettings({
  vapidPublicKey,
  devices,
  mutedCategories,
  quietHoursStart,
  quietHoursEnd,
}: {
  vapidPublicKey: string | null;
  devices: { endpoint: string; label: string | null }[];
  mutedCategories: string[];
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}) {
  const [prefState, prefAction] = useActionState<
    NotificationSettingsState,
    FormData
  >(saveNotificationPreferences, {});
  const [busy, startTransition] = useTransition();
  const [deviceMessage, setDeviceMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const enable = () =>
    startTransition(async () => {
      setDeviceMessage(null);

      if (!vapidPublicKey) {
        setDeviceMessage({
          tone: "error",
          text: "Push notifications are not configured on this server yet.",
        });
        return;
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setDeviceMessage({
          tone: "error",
          text: "This browser cannot receive notifications. On iPhone, add StayFlow to your home screen first.",
        });
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setDeviceMessage({
          tone: "error",
          // Being specific matters: once denied, the app cannot ask again.
          text: "Notifications are blocked for StayFlow. You will need to allow them in your browser settings.",
        });
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBuffer(vapidPublicKey),
        });

        const json = subscription.toJSON();
        const result = await savePushSubscription({
          endpoint: subscription.endpoint,
          p256dh: json.keys?.p256dh,
          auth: json.keys?.auth,
          userAgent: navigator.userAgent.slice(0, 500),
        });

        setDeviceMessage(
          result.error
            ? { tone: "error", text: result.error }
            : { tone: "success", text: result.success ?? "Notifications on." },
        );
      } catch {
        setDeviceMessage({
          tone: "error",
          text: "Could not turn on notifications for this device.",
        });
      }
    });

  const disable = (endpoint: string) =>
    startTransition(async () => {
      const result = await removePushSubscription(endpoint);
      setDeviceMessage(
        result.error
          ? { tone: "error", text: result.error }
          : { tone: "success", text: result.success ?? "Notifications off." },
      );
      try {
        const registration = await navigator.serviceWorker.ready;
        const sub = await registration.pushManager.getSubscription();
        if (sub?.endpoint === endpoint) await sub.unsubscribe();
      } catch {
        // The server record is gone either way, which is what stops delivery.
      }
    });

  return (
    <section
      aria-labelledby="notifications-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2
        id="notifications-heading"
        className="text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        Notifications
      </h2>

      {deviceMessage && (
        <div className="mt-3">
          <Alert tone={deviceMessage.tone}>{deviceMessage.text}</Alert>
        </div>
      )}

      <div className="mt-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {devices.length === 0
            ? "This device is not set up to receive notifications."
            : `${devices.length} device${devices.length === 1 ? "" : "s"} set up.`}
        </p>

        {devices.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {devices.map((d) => (
              <li
                key={d.endpoint}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="truncate text-slate-700 dark:text-slate-300">
                  {d.label ?? "A device"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => disable(d.endpoint)}
                >
                  Turn off
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3">
          <Button variant="outline" size="sm" disabled={busy} onClick={enable}>
            {busy ? "Working…" : "Turn on for this device"}
          </Button>
        </div>
      </div>

      <form action={prefAction} className="mt-6 space-y-4 border-t border-slate-100 pt-4 dark:border-slate-800">
        {prefState.error && <Alert tone="error">{prefState.error}</Alert>}
        {prefState.success && <Alert tone="success">{prefState.success}</Alert>}

        <fieldset>
          <legend className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Mute these
          </legend>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Muted notifications still appear in the app — they just will not
            buzz your phone.
          </p>
          <div className="mt-2 space-y-1.5">
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <label
                key={value}
                className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300"
              >
                <input
                  type="checkbox"
                  name="muted"
                  value={value}
                  defaultChecked={mutedCategories.includes(value)}
                  disabled={isUrgent(value)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 disabled:opacity-40"
                />
                <span>
                  {label}
                  {isUrgent(value) && (
                    <span className="ml-1 text-xs text-slate-500">
                      (always sent)
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Quiet hours from"
            htmlFor="quiet-start"
            hint="Cancelled shifts and urgent notices still come through."
          >
            <Input
              id="quiet-start"
              name="quietHoursStart"
              type="time"
              defaultValue={quietHoursStart?.slice(0, 5) ?? ""}
            />
          </Field>
          <Field label="Until" htmlFor="quiet-end">
            <Input
              id="quiet-end"
              name="quietHoursEnd"
              type="time"
              defaultValue={quietHoursEnd?.slice(0, 5) ?? ""}
            />
          </Field>
        </div>

        <SaveButton />
      </form>
    </section>
  );
}
