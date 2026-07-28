/**
 * Clock state derived from an event stream.
 *
 * `clock_events` is append-only: nothing is ever edited or deleted, so the
 * current state is always a fold over the events rather than a column
 * somebody keeps up to date. That is deliberate — a stored status column and
 * an event log inevitably disagree, and when they do there is no way to tell
 * which one lied.
 *
 * The stream is NOT assumed to be well formed. A phone dying mid-shift, an
 * offline queue replaying late, or someone clocking in on the kiosk having
 * already clocked in on their phone all produce sequences that no clean
 * state machine would emit. These functions degrade to something sensible
 * and report what looked wrong, rather than throwing or inventing hours.
 */

export type ClockEventType =
  | "clock_in"
  | "break_start"
  | "break_end"
  | "clock_out";

export type ClockStatus = "clocked_out" | "clocked_in" | "on_break";

export interface ClockEvent {
  id: string;
  eventType: ClockEventType;
  /** Server-stamped instant. Never trust a client clock for ordering. */
  serverTime: string;
  shiftId?: string | null;
}

export interface ClockState {
  status: ClockStatus;
  /** When the current status began, or null when clocked out. */
  since: string | null;
  /** Shift the open session is attached to, if any. */
  shiftId: string | null;
}

/** Sort by server time, falling back to id so the order is total. */
function chronological(events: ClockEvent[]): ClockEvent[] {
  return [...events].sort((a, b) => {
    const diff = a.serverTime.localeCompare(b.serverTime);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

/**
 * Current state from the day's events.
 *
 * Later events win: two consecutive clock_ins leave one open session rather
 * than two, and a break_end with no break_start simply returns the person to
 * clocked-in instead of being ignored.
 */
export function deriveClockState(events: ClockEvent[]): ClockState {
  let status: ClockStatus = "clocked_out";
  let since: string | null = null;
  let shiftId: string | null = null;

  for (const event of chronological(events)) {
    switch (event.eventType) {
      case "clock_in":
        status = "clocked_in";
        since = event.serverTime;
        shiftId = event.shiftId ?? null;
        break;
      case "break_start":
        // Only meaningful while working; a break from clocked-out is noise.
        if (status === "clocked_in") {
          status = "on_break";
          since = event.serverTime;
        }
        break;
      case "break_end":
        if (status === "on_break") {
          status = "clocked_in";
          since = event.serverTime;
        }
        break;
      case "clock_out":
        status = "clocked_out";
        since = null;
        shiftId = null;
        break;
    }
  }

  return { status, since, shiftId };
}

/** Which actions make sense from a given state. */
export function allowedActions(status: ClockStatus): ClockEventType[] {
  switch (status) {
    case "clocked_out":
      return ["clock_in"];
    case "clocked_in":
      return ["break_start", "clock_out"];
    case "on_break":
      // Clocking out straight from a break is allowed: people forget to end
      // one, and refusing would leave them unable to finish their shift.
      return ["break_end", "clock_out"];
  }
}

export function isActionAllowed(
  status: ClockStatus,
  action: ClockEventType,
): boolean {
  return allowedActions(status).includes(action);
}

export interface WorkSummary {
  /** Minutes between clock in and clock out, less breaks. */
  workedMinutes: number;
  breakMinutes: number;
  /** True when a session is still open, so the total is a running one. */
  inProgress: boolean;
  /** Things worth a manager's eye. Never silently swallowed. */
  anomalies: string[];
}

/**
 * Total worked and break time across a day's events.
 *
 * `now` is injected so a running session can be measured, and so the result
 * is deterministic under test.
 */
export function summariseWorkedTime(
  events: ClockEvent[],
  now: Date = new Date(),
): WorkSummary {
  const ordered = chronological(events);
  const anomalies: string[] = [];

  let workedMs = 0;
  let breakMs = 0;
  let inAt: Date | null = null;
  let breakAt: Date | null = null;

  for (const event of ordered) {
    const at = new Date(event.serverTime);

    switch (event.eventType) {
      case "clock_in":
        if (inAt) {
          anomalies.push(
            "Clocked in twice without clocking out. The earlier session was closed automatically.",
          );
          // Close the dangling session at this point rather than losing it.
          workedMs += at.getTime() - inAt.getTime();
          if (breakAt) {
            breakMs += at.getTime() - breakAt.getTime();
            breakAt = null;
          }
        }
        inAt = at;
        break;

      case "break_start":
        if (!inAt) {
          anomalies.push("A break started while not clocked in.");
          break;
        }
        if (breakAt) {
          anomalies.push("A break started while already on a break.");
          break;
        }
        breakAt = at;
        break;

      case "break_end":
        if (!breakAt) {
          anomalies.push("A break ended without one having started.");
          break;
        }
        breakMs += at.getTime() - breakAt.getTime();
        breakAt = null;
        break;

      case "clock_out":
        if (!inAt) {
          anomalies.push("Clocked out without having clocked in.");
          break;
        }
        if (breakAt) {
          // Clocking out mid-break: count the break up to the clock out.
          breakMs += at.getTime() - breakAt.getTime();
          breakAt = null;
        }
        workedMs += at.getTime() - inAt.getTime();
        inAt = null;
        break;
    }
  }

  const inProgress = inAt !== null;

  if (inAt) {
    workedMs += now.getTime() - inAt.getTime();
    if (breakAt) breakMs += now.getTime() - breakAt.getTime();
  }

  // Breaks sit inside the clocked-in span, so subtract them out.
  const netMs = Math.max(0, workedMs - breakMs);

  return {
    workedMinutes: Math.round(netMs / 60_000),
    breakMinutes: Math.round(breakMs / 60_000),
    inProgress,
    anomalies,
  };
}

/**
 * A stable idempotency key for an action.
 *
 * The offline queue may replay an event when a device reconnects, and
 * `clock_events` is append-only, so a duplicate cannot be tidied up
 * afterwards. The key is derived from the user, the action and the device's
 * own timestamp, so the same queued action always produces the same key no
 * matter how many times it is sent.
 */
export function idempotencyKeyFor(input: {
  userId: string;
  eventType: ClockEventType;
  clientTime: string;
  deviceId?: string | null;
}): string {
  return [
    input.userId,
    input.eventType,
    input.clientTime,
    input.deviceId ?? "no-device",
  ].join(":");
}
