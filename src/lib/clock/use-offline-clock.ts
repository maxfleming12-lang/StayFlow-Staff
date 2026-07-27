"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { recordPunch } from "./actions";
import {
  canQueueOffline,
  enqueue,
  flush,
  indexedDbStorage,
  pending,
  type QueueStorage,
  type QueuedPunch,
  type SendResult,
} from "./offline-queue";
import { idempotencyKeyFor, type ClockEventType } from "./state";

/**
 * Clock punching that survives losing signal.
 *
 * A punch is written to the local queue FIRST, then sent. That order is
 * deliberate: if the tab is closed or the phone dies between pressing the
 * button and the request completing, the punch is still on the device and
 * goes out on the next load. Sending first and queuing on failure would
 * lose exactly the punches that matter most.
 *
 * Replays are safe because every punch carries a stable idempotency key,
 * and the server treats an already-recorded key as success.
 */
export function useOfflineClock(options: {
  userId: string;
  propertyId: string;
  deviceIdRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [queuedCount, setQueuedCount] = useState(0);
  const [failed, setFailed] = useState<QueuedPunch[]>([]);
  const flushingRef = useRef(false);

  // Lazy state initialiser rather than a ref assigned during render: reading
  // or writing a ref while rendering is unsafe under concurrent rendering,
  // and this only ever needs to be created once.
  const [storage] = useState<QueueStorage | null>(() =>
    canQueueOffline() ? indexedDbStorage() : null,
  );

  const refreshCount = useCallback(async () => {
    if (!storage) return;
    setQueuedCount((await pending(storage)).length);
  }, [storage]);

  /** Send one queued punch through the server action. */
  const send = useCallback(async (item: QueuedPunch): Promise<SendResult> => {
    const form = new FormData();
    form.set("eventType", item.eventType);
    form.set("propertyId", item.propertyId);
    form.set("clientTime", item.clientTime);
    form.set("deviceId", item.deviceId);
    form.set("wasOffline", "true");
    if (item.shiftId) form.set("shiftId", item.shiftId);

    try {
      const result = await recordPunch({}, form);

      if (result.duplicate) return { outcome: "duplicate" };
      if (result.success) return { outcome: "sent" };

      // A refusal such as "you are already clocked in" will never succeed on
      // a later attempt — the state it conflicts with is already recorded.
      // Retrying forever would block every punch behind it.
      if (result.error && !/cannot reach|network|offline/i.test(result.error)) {
        return { outcome: "rejected", error: result.error };
      }
      return { outcome: "retry", error: result.error ?? "unknown" };
    } catch (error) {
      return {
        outcome: "retry",
        error: error instanceof Error ? error.message : "network",
      };
    }
  }, []);

  const flushQueue = useCallback(async () => {
    // A second flush while one is running would send the same punch twice.
    // The idempotency key makes that harmless, but it is still wasted work.
    if (!storage || flushingRef.current || !navigator.onLine) return;

    flushingRef.current = true;
    try {
      const summary = await flush(storage, send);
      if (summary.failed.length > 0) {
        setFailed((prev) => [...prev, ...summary.failed]);
      }
      await refreshCount();
    } finally {
      flushingRef.current = false;
    }
  }, [storage, send, refreshCount]);

  /** Record a punch: queue it, then try to send straight away. */
  const punch = useCallback(
    async (input: {
      eventType: ClockEventType;
      shiftId?: string | null;
    }) => {
      const clientTime = new Date().toISOString();
      const deviceId = options.deviceIdRef.current?.value || "unknown-device";

      const key = idempotencyKeyFor({
        userId: options.userId,
        eventType: input.eventType,
        clientTime,
        deviceId,
      });

      // No IndexedDB (an old browser, or a private window): send directly
      // rather than pretending the punch is safely stored.
      if (!storage) {
        return send({
          key,
          eventType: input.eventType,
          propertyId: options.propertyId,
          shiftId: input.shiftId,
          clientTime,
          deviceId,
          attempts: 0,
        });
      }

      await enqueue(storage, {
        key,
        eventType: input.eventType,
        propertyId: options.propertyId,
        shiftId: input.shiftId,
        clientTime,
        deviceId,
      });
      await refreshCount();
      await flushQueue();
      return null;
    },
    [
      storage,
      options.userId,
      options.propertyId,
      options.deviceIdRef,
      send,
      refreshCount,
      flushQueue,
    ],
  );

  // Sync with the local queue on mount, and flush whenever the connection
  // comes back. The work is deferred into a callback rather than run in the
  // effect body so state is never set synchronously during the effect, and
  // so a component unmounted mid-flush does not update afterwards.
  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      if (cancelled) return;
      await refreshCount();
      if (cancelled) return;
      await flushQueue();
    };

    void sync();

    const onOnline = () => void sync();
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [refreshCount, flushQueue]);

  return { punch, queuedCount, failed, flushQueue };
}
