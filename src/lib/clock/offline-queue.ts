import type { ClockEventType } from "./state";

/**
 * Offline queue for clock events.
 *
 * A staff member in a motel car park or a linen store loses signal
 * constantly, and "clock in" is not an action you can ask someone to retry
 * later — they are standing at the door about to start work. So a punch is
 * recorded locally first and sent when the network allows.
 *
 * The queue is deliberately written against a small storage interface
 * rather than IndexedDB directly, so the ordering, retry and dead-letter
 * behaviour can be tested without a browser. `indexedDbStorage()` is the
 * real implementation; tests use an in-memory one.
 */

export interface QueuedPunch {
  /** The idempotency key. Also the storage key — one row per real action. */
  key: string;
  eventType: ClockEventType;
  propertyId: string;
  shiftId?: string | null;
  /** The device's clock at the moment the button was pressed. */
  clientTime: string;
  deviceId: string;
  /** How many times sending has been attempted. */
  attempts: number;
  /** Last failure, kept so a stuck item can be explained rather than hidden. */
  lastError?: string;
}

/** Minimal async key-value store, so the logic is testable. */
export interface QueueStorage {
  getAll(): Promise<QueuedPunch[]>;
  put(item: QueuedPunch): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Give up sending after this many attempts.
 *
 * Without a limit, one permanently-invalid punch — a property the person no
 * longer has access to, say — would be retried on every reconnect forever
 * and block the queue behind it. A dead item is surfaced to the staff
 * member instead, because a punch that never arrived is something they need
 * to know about, not something to discard quietly.
 */
export const MAX_ATTEMPTS = 5;

export type SendResult =
  | { outcome: "sent" }
  /** Already recorded server-side — a replay. Treated as success. */
  | { outcome: "duplicate" }
  /** Network or server problem; worth trying again. */
  | { outcome: "retry"; error: string }
  /** Will never succeed; stop trying. */
  | { outcome: "rejected"; error: string };

export interface FlushSummary {
  sent: number;
  duplicates: number;
  stillQueued: number;
  /** Items that hit MAX_ATTEMPTS or were rejected outright. */
  failed: QueuedPunch[];
}

/** Add a punch to the queue. Re-queuing the same key is a no-op update. */
export async function enqueue(
  storage: QueueStorage,
  punch: Omit<QueuedPunch, "attempts">,
): Promise<void> {
  await storage.put({ ...punch, attempts: 0 });
}

/** Everything waiting, oldest first — the order the person pressed them. */
export async function pending(storage: QueueStorage): Promise<QueuedPunch[]> {
  const all = await storage.getAll();
  return all.sort((a, b) => a.clientTime.localeCompare(b.clientTime));
}

/**
 * Try to send everything waiting.
 *
 * Order matters: a clock-out sent before its clock-in would derive a
 * nonsense state, so a retryable failure stops the run rather than skipping
 * ahead. A rejected item is removed and reported, since leaving it at the
 * head would block every later punch permanently.
 */
export async function flush(
  storage: QueueStorage,
  send: (punch: QueuedPunch) => Promise<SendResult>,
): Promise<FlushSummary> {
  const queue = await pending(storage);
  const failed: QueuedPunch[] = [];
  let sent = 0;
  let duplicates = 0;

  for (let i = 0; i < queue.length; i += 1) {
    const punch = queue[i];
    const result = await send(punch);

    if (result.outcome === "sent" || result.outcome === "duplicate") {
      await storage.remove(punch.key);
      if (result.outcome === "sent") sent += 1;
      else duplicates += 1;
      continue;
    }

    if (result.outcome === "rejected") {
      await storage.remove(punch.key);
      failed.push({ ...punch, lastError: result.error });
      continue;
    }

    // Retryable. Record the attempt, then stop: sending later punches now
    // would deliver them out of order.
    const attempts = punch.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await storage.remove(punch.key);
      failed.push({ ...punch, attempts, lastError: result.error });
      continue;
    }

    await storage.put({ ...punch, attempts, lastError: result.error });
    // This item and everything after it are still waiting. Items before it
    // were either sent or removed, so they are not counted.
    return { sent, duplicates, stillQueued: queue.length - i, failed };
  }

  return { sent, duplicates, stillQueued: 0, failed };
}

/* ------------------------------------------------------------------ */
/* IndexedDB implementation                                            */
/* ------------------------------------------------------------------ */

const DB_NAME = "stayflow-clock";
const STORE = "queued-punches";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * IndexedDB-backed storage.
 *
 * IndexedDB rather than localStorage because a queued punch must survive the
 * browser being killed, and because localStorage is synchronous and blocks
 * the main thread on a phone that is already struggling.
 */
export function indexedDbStorage(): QueueStorage {
  return {
    async getAll() {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, "readonly");
        return await promisify(
          tx.objectStore(STORE).getAll() as IDBRequest<QueuedPunch[]>,
        );
      } finally {
        db.close();
      }
    },
    async put(item) {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, "readwrite");
        await promisify(tx.objectStore(STORE).put(item));
      } finally {
        db.close();
      }
    },
    async remove(key) {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, "readwrite");
        await promisify(tx.objectStore(STORE).delete(key));
      } finally {
        db.close();
      }
    },
  };
}

/** True when this browser can queue offline at all. */
export function canQueueOffline(): boolean {
  return typeof indexedDB !== "undefined";
}
