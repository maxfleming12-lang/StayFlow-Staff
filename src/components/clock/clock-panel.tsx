"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Coffee, LogIn, LogOut, Play } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useOfflineClock } from "@/lib/clock/use-offline-clock";
import {
  allowedActions,
  type ClockEventType,
  type ClockState,
} from "@/lib/clock/state";

const LABELS: Record<ClockEventType, string> = {
  clock_in: "Clock in",
  break_start: "Start break",
  break_end: "End break",
  clock_out: "Clock out",
};

const ICONS: Record<ClockEventType, typeof LogIn> = {
  clock_in: LogIn,
  break_start: Coffee,
  break_end: Play,
  clock_out: LogOut,
};

const STATUS_TEXT: Record<ClockState["status"], string> = {
  clocked_out: "Not clocked in",
  clocked_in: "On shift",
  on_break: "On a break",
};

function PunchButton({
  action,
  primary,
  pending,
  onPress,
}: {
  action: ClockEventType;
  primary: boolean;
  pending: boolean;
  onPress: () => void;
}) {
  const Icon = ICONS[action];
  return (
    <Button
      type="button"
      variant={primary ? "primary" : "outline"}
      disabled={pending}
      aria-busy={pending}
      onClick={onPress}
      // Deliberately large: this is pressed with a thumb, often in a hurry,
      // sometimes with wet hands after cleaning.
      className="h-14 flex-1 text-base"
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      {pending ? "Saving…" : LABELS[action]}
    </Button>
  );
}

/** Live elapsed time since the current status began. */
function Elapsed({ since }: { since: string }) {
  const [text, setText] = useState("");

  useEffect(() => {
    const tick = () => {
      const ms = Date.now() - new Date(since).getTime();
      const mins = Math.max(0, Math.floor(ms / 60_000));
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      setText(h > 0 ? `${h}h ${m}m` : `${m}m`);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [since]);

  return <span suppressHydrationWarning>{text}</span>;
}

/**
 * The time clock.
 *
 * Shows one obvious next action. A staff member finishing a shift should not
 * have to work out which of four buttons applies to them, so only the
 * transitions that are actually possible are rendered.
 */
export function ClockPanel({
  state,
  propertyId,
  propertyName,
  shiftId,
  userId,
}: {
  state: ClockState;
  propertyId: string;
  propertyName: string;
  shiftId: string | null;
  userId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    tone: "success" | "error" | "warning";
    text: string;
  } | null>(null);
  // A stable per-device id, so a replayed action from THIS device is
  // recognised as the same action rather than a new one.
  //
  // Written straight into the hidden field via a ref rather than held in
  // state: it never affects what is rendered, and putting it in state would
  // force an extra render on every mount purely to stamp a form value.
  // localStorage is unavailable during server rendering, hence the effect.
  const deviceIdRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const KEY = "stayflow-device-id";
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    if (deviceIdRef.current) deviceIdRef.current.value = id;
  }, []);

  // Online status DOES drive the UI, so it is subscribed to properly rather
  // than assigned inside an effect.
  const online = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("online", onChange);
      window.addEventListener("offline", onChange);
      return () => {
        window.removeEventListener("online", onChange);
        window.removeEventListener("offline", onChange);
      };
    },
    () => navigator.onLine,
    // Assume online while server-rendering; the client corrects it at once.
    () => true,
  );

  const { punch, queuedCount, failed } = useOfflineClock({
    userId,
    propertyId,
    deviceIdRef,
  });

  const actions = allowedActions(state.status);

  const press = (action: ClockEventType) => {
    setMessage(null);
    startTransition(async () => {
      // Queued locally first, so the punch survives the tab closing before
      // the request finishes. `result` is only non-null when the browser
      // cannot queue at all and the send happened inline.
      const result = await punch({ eventType: action, shiftId });

      if (result?.outcome === "rejected") {
        setMessage({ tone: "error", text: result.error });
      } else if (!navigator.onLine) {
        setMessage({
          tone: "warning",
          text: "Saved on this device. It will be sent when you have signal.",
        });
      }
      // Re-read the derived state from the server rather than guessing it.
      router.refresh();
    });
  };

  return (
    <section
      aria-labelledby="clock-heading"
      className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2 id="clock-heading" className="sr-only">
        Time clock
      </h2>

      <div className="text-center">
        <p
          className={`text-sm font-medium ${
            state.status === "clocked_out"
              ? "text-slate-500 dark:text-slate-400"
              : "text-teal-700 dark:text-teal-400"
          }`}
        >
          {STATUS_TEXT[state.status]}
        </p>
        {state.since && (
          <p className="mt-1 text-3xl font-semibold text-slate-900 dark:text-slate-50">
            <Elapsed since={state.since} />
          </p>
        )}
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {propertyName}
        </p>
      </div>

      {!online && (
        <div className="mt-4">
          <Alert tone="warning">
            You are offline. You can still clock in and out — it will be sent
            when you have signal again.
          </Alert>
        </div>
      )}

      {message && (
        <div className="mt-4">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      )}

      {queuedCount > 0 && (
        <div className="mt-4">
          <Alert tone="warning">
            {queuedCount === 1
              ? "1 entry is waiting to be sent."
              : `${queuedCount} entries are waiting to be sent.`}{" "}
            They are saved on this device and will go through automatically.
          </Alert>
        </div>
      )}

      {failed.length > 0 && (
        <div className="mt-4">
          <Alert tone="error" title="Some entries could not be sent">
            {failed.length === 1 ? "An entry" : `${failed.length} entries`} could
            not be recorded. Tell your manager so your hours can be corrected.
          </Alert>
        </div>
      )}

      {/* The device id is stamped into a hidden field by the effect above and
          read back when queuing, so it survives without a re-render. */}
      <input type="hidden" ref={deviceIdRef} />

      <div className="mt-5 flex gap-3">
        {actions.map((action, index) => (
          <PunchButton
            key={action}
            action={action}
            primary={index === actions.length - 1}
            pending={isPending}
            onPress={() => press(action)}
          />
        ))}
      </div>

      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
        Times are recorded by StayFlow&rsquo;s server, not your phone, so a
        wrong device clock cannot change your hours. Your recorded times go to
        your manager for approval.
      </p>
    </section>
  );
}
