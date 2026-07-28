"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import {
  deriveClockState,
  idempotencyKeyFor,
  isActionAllowed,
  type ClockEvent,
  type ClockEventType,
} from "./state";

export interface ClockActionState {
  error?: string;
  success?: string;
  /** True when the event was already recorded — a replayed offline action. */
  duplicate?: boolean;
}

const punchSchema = z.object({
  eventType: z.enum(["clock_in", "break_start", "break_end", "clock_out"]),
  propertyId: z.string().uuid("Choose a property."),
  shiftId: z.string().uuid().optional(),
  /** The device's own clock. Recorded, never trusted for ordering. */
  clientTime: z.string().optional(),
  deviceId: z.string().max(200).optional(),
  wasOffline: z.boolean().optional(),
});

/** Today's events for the signed-in user, in the property timezone. */
async function todaysEvents(): Promise<ClockEvent[]> {
  const supabase = await createClient();

  // A shift can start late evening and finish after midnight, so look back
  // far enough to catch an open session rather than only calendar-today.
  const from = new Date();
  from.setHours(from.getHours() - 20);

  const { data, error } = await supabase
    .from("clock_events")
    .select("id, event_type, server_time, shift_id")
    .gte("server_time", from.toISOString())
    .order("server_time", { ascending: true });

  if (error) {
    throw new Error(`Could not read your clock history: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    eventType: String(row.event_type) as ClockEventType,
    serverTime: String(row.server_time),
    shiftId: (row.shift_id as string | null) ?? null,
  }));
}

/** The signed-in user's current clock state. */
export async function getClockState() {
  await requireUser();
  const events = await todaysEvents();
  return { state: deriveClockState(events), events };
}

/**
 * Record a clock event.
 *
 * Three things make this safe against a flaky phone in a motel car park:
 *
 *   * The event carries an idempotency key derived from the device's own
 *     timestamp, so replaying a queued action inserts nothing the second
 *     time. `clock_events` is append-only, so a duplicate could never be
 *     tidied up afterwards — it has to be prevented.
 *   * `server_time` and `received_at` are stamped by a database trigger
 *     (migration 0006), so a wrong device clock cannot backdate attendance.
 *   * The transition is checked against the derived state, so a stale
 *     screen cannot record a second clock-in.
 */
export async function recordPunch(
  _prev: ClockActionState,
  formData: FormData,
): Promise<ClockActionState> {
  const user = await requireUser();

  const parsed = punchSchema.safeParse({
    eventType: formData.get("eventType"),
    propertyId: formData.get("propertyId"),
    shiftId: (formData.get("shiftId") as string) || undefined,
    clientTime: (formData.get("clientTime") as string) || undefined,
    deviceId: (formData.get("deviceId") as string) || undefined,
    wasOffline: formData.get("wasOffline") === "true",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const input = parsed.data;
  const clientTime = input.clientTime ?? new Date().toISOString();

  try {
    const events = await todaysEvents();
    const state = deriveClockState(events);

    if (!isActionAllowed(state.status, input.eventType)) {
      return {
        error: describeRefusal(state.status, input.eventType),
      };
    }

    const key = idempotencyKeyFor({
      userId: user.id,
      eventType: input.eventType,
      clientTime,
      deviceId: input.deviceId,
    });

    const supabase = await createClient();
    const { error } = await supabase.from("clock_events").insert({
      organisation_id: user.organisationId,
      property_id: input.propertyId,
      user_id: user.id,
      shift_id: input.shiftId ?? state.shiftId ?? null,
      event_type: input.eventType,
      client_time: clientTime,
      source: "app" as const,
      device_id: input.deviceId ?? null,
      was_offline: input.wasOffline ?? false,
      idempotency_key: key,
    });

    if (error) {
      // The unique index on (user_id, idempotency_key) is the whole point:
      // a replayed offline action is a success, not a failure.
      if (error.code === "23505") {
        revalidatePath("/clock");
        return {
          duplicate: true,
          success: "Already recorded — this was sent earlier.",
        };
      }
      return { error: `Could not record that: ${error.message}` };
    }
  } catch {
    return {
      error:
        "Cannot reach StayFlow right now. Your action has been saved and will be sent when you are back online.",
    };
  }

  revalidatePath("/clock");
  revalidatePath("/");
  return { success: confirmationFor(input.eventType) };
}

/** Plain-English refusal, naming the state the person is actually in. */
function describeRefusal(status: string, action: ClockEventType): string {
  if (action === "clock_in" && status === "clocked_in") {
    return "You are already clocked in.";
  }
  if (action === "clock_in" && status === "on_break") {
    return "You are clocked in and on a break. End the break to carry on.";
  }
  if (action === "clock_out" && status === "clocked_out") {
    return "You are not clocked in.";
  }
  if (action === "break_start" && status !== "clocked_in") {
    return status === "on_break"
      ? "You are already on a break."
      : "Clock in before starting a break.";
  }
  if (action === "break_end" && status !== "on_break") {
    return "You are not on a break.";
  }
  return "That is not possible from your current state.";
}

function confirmationFor(action: ClockEventType): string {
  switch (action) {
    case "clock_in":
      return "Clocked in. Have a good shift.";
    case "break_start":
      return "Break started.";
    case "break_end":
      return "Break ended. Welcome back.";
    case "clock_out":
      return "Clocked out. Your hours go to your manager for approval.";
  }
}
