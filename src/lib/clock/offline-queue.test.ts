import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  enqueue,
  flush,
  pending,
  type QueueStorage,
  type QueuedPunch,
  type SendResult,
} from "./offline-queue";

/** In-memory storage, so the queue logic is testable without a browser. */
function memoryStorage(seed: QueuedPunch[] = []): QueueStorage {
  const map = new Map(seed.map((p) => [p.key, { ...p }]));
  return {
    async getAll() {
      return [...map.values()].map((p) => ({ ...p }));
    },
    async put(item) {
      map.set(item.key, { ...item });
    },
    async remove(key) {
      map.delete(key);
    },
  };
}

const punch = (
  key: string,
  clientTime: string,
  over: Partial<QueuedPunch> = {},
): QueuedPunch => ({
  key,
  eventType: "clock_in",
  propertyId: "prop-1",
  clientTime,
  deviceId: "device-a",
  attempts: 0,
  ...over,
});

const T = (hhmm: string) => `2026-08-05T${hhmm}:00+10:00`;

describe("enqueue and pending", () => {
  it("stores a punch with no attempts yet", async () => {
    const storage = memoryStorage();
    await enqueue(storage, {
      key: "k1",
      eventType: "clock_in",
      propertyId: "prop-1",
      clientTime: T("09:00"),
      deviceId: "device-a",
    });
    const queue = await pending(storage);
    expect(queue).toHaveLength(1);
    expect(queue[0].attempts).toBe(0);
  });

  it("returns punches oldest first, the order they were pressed", async () => {
    const storage = memoryStorage([
      punch("late", T("17:00")),
      punch("early", T("09:00")),
      punch("middle", T("12:00")),
    ]);
    const queue = await pending(storage);
    expect(queue.map((p) => p.key)).toEqual(["early", "middle", "late"]);
  });

  it("re-queuing the same key replaces rather than duplicates", async () => {
    const storage = memoryStorage();
    const base = {
      key: "same",
      eventType: "clock_in" as const,
      propertyId: "prop-1",
      clientTime: T("09:00"),
      deviceId: "device-a",
    };
    await enqueue(storage, base);
    await enqueue(storage, base);
    expect(await pending(storage)).toHaveLength(1);
  });
});

describe("flush", () => {
  const sendAlways = (outcome: SendResult["outcome"]) => async () =>
    ({ outcome, error: "x" }) as SendResult;

  it("sends everything and empties the queue", async () => {
    const storage = memoryStorage([
      punch("a", T("09:00")),
      punch("b", T("12:00")),
    ]);
    const summary = await flush(storage, sendAlways("sent"));

    expect(summary).toMatchObject({ sent: 2, duplicates: 0, stillQueued: 0 });
    expect(await pending(storage)).toEqual([]);
  });

  it("treats a duplicate as success and removes it", async () => {
    // The server already has it — a replay after a flaky connection.
    const storage = memoryStorage([punch("a", T("09:00"))]);
    const summary = await flush(storage, sendAlways("duplicate"));

    expect(summary.duplicates).toBe(1);
    expect(summary.sent).toBe(0);
    expect(await pending(storage)).toEqual([]);
  });

  it("sends in chronological order", async () => {
    const seen: string[] = [];
    const storage = memoryStorage([
      punch("out", T("17:00"), { eventType: "clock_out" }),
      punch("in", T("09:00")),
    ]);
    await flush(storage, async (p) => {
      seen.push(p.key);
      return { outcome: "sent" };
    });
    // A clock-out arriving before its clock-in would derive nonsense.
    expect(seen).toEqual(["in", "out"]);
  });

  it("STOPS at a retryable failure rather than sending later punches", async () => {
    const seen: string[] = [];
    const storage = memoryStorage([
      punch("in", T("09:00")),
      punch("out", T("17:00"), { eventType: "clock_out" }),
    ]);

    const summary = await flush(storage, async (p) => {
      seen.push(p.key);
      return p.key === "in"
        ? { outcome: "retry", error: "offline" }
        : { outcome: "sent" };
    });

    // The clock-out must NOT have been attempted.
    expect(seen).toEqual(["in"]);
    expect(summary.stillQueued).toBe(2);
    expect(await pending(storage)).toHaveLength(2);
  });

  it("keeps a retryable punch and counts the attempt", async () => {
    const storage = memoryStorage([punch("a", T("09:00"))]);
    await flush(storage, sendAlways("retry"));

    const queue = await pending(storage);
    expect(queue).toHaveLength(1);
    expect(queue[0].attempts).toBe(1);
    expect(queue[0].lastError).toBe("x");
  });

  it("gives up after MAX_ATTEMPTS and reports the punch as failed", async () => {
    const storage = memoryStorage([
      punch("a", T("09:00"), { attempts: MAX_ATTEMPTS - 1 }),
    ]);
    const summary = await flush(storage, sendAlways("retry"));

    // Removed from the queue so it cannot block everything behind it...
    expect(await pending(storage)).toEqual([]);
    // ...but surfaced, because a punch that never arrived matters.
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].key).toBe("a");
  });

  it("drops a rejected punch and carries on with the rest", async () => {
    const storage = memoryStorage([
      punch("bad", T("09:00")),
      punch("good", T("12:00")),
    ]);

    const summary = await flush(storage, async (p) =>
      p.key === "bad"
        ? { outcome: "rejected", error: "no access to that property" }
        : { outcome: "sent" },
    );

    // A permanently invalid punch must not block the queue behind it.
    expect(summary.sent).toBe(1);
    expect(summary.failed.map((f) => f.key)).toEqual(["bad"]);
    expect(await pending(storage)).toEqual([]);
  });

  it("is safe to run twice — the second run has nothing to do", async () => {
    const storage = memoryStorage([punch("a", T("09:00"))]);
    await flush(storage, sendAlways("sent"));
    const second = await flush(storage, sendAlways("sent"));

    expect(second).toMatchObject({ sent: 0, stillQueued: 0, failed: [] });
  });

  it("handles an empty queue", async () => {
    const summary = await flush(memoryStorage(), sendAlways("sent"));
    expect(summary).toMatchObject({ sent: 0, duplicates: 0, stillQueued: 0 });
  });
});
