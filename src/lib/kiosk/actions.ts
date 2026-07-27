"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { deriveClockState, isActionAllowed, type ClockEvent, type ClockEventType } from "@/lib/clock/state";
import { getKioskSession } from "./session";

export interface KioskActionState {
  error?: string;
  success?: string;
  /** Shown once, when a device is authorised. Never retrievable later. */
  kioskUrl?: string;
}

/* ------------------------------------------------------------------ */
/* Manager: authorise and revoke devices, set PINs                     */
/* ------------------------------------------------------------------ */

const authoriseSchema = z.object({
  propertyId: z.string().uuid("Choose a property."),
  deviceLabel: z.string().trim().max(100).optional(),
  days: z.coerce.number().int().min(1).max(365).default(90),
});

/**
 * Authorise a tablet as a kiosk for one property.
 *
 * The link is shown ONCE. It is a credential: anyone opening it can reach
 * the kiosk screen for that property, so it is not stored anywhere
 * retrievable and not emailed. A manager opens it on the tablet there and
 * then, and revokes it if the tablet goes missing.
 */
export async function authoriseKiosk(
  _prev: KioskActionState,
  formData: FormData,
): Promise<KioskActionState> {
  const user = await requireRole("manager");

  const parsed = authoriseSchema.safeParse({
    propertyId: formData.get("propertyId"),
    deviceLabel: (formData.get("deviceLabel") as string) || undefined,
    days: formData.get("days") ?? 90,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    const supabase = await createClient();
    const token = randomBytes(32).toString("base64url");
    const expires = new Date();
    expires.setDate(expires.getDate() + parsed.data.days);

    const { error } = await supabase.from("kiosk_sessions").insert({
      organisation_id: user.organisationId,
      property_id: parsed.data.propertyId,
      token,
      device_label: parsed.data.deviceLabel ?? null,
      created_by: user.id,
      expires_at: expires.toISOString(),
    });

    if (error) return { error: `Could not authorise: ${error.message}` };

    const { siteUrl } = await import("@/lib/supabase/env");
    revalidatePath("/manage/kiosk");
    return {
      success: `Device authorised until ${expires.toLocaleDateString("en-AU")}.`,
      kioskUrl: `${siteUrl()}/kiosk/start?token=${token}`,
    };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }
}

/** Revoke a device. It stops working on its next request. */
export async function revokeKiosk(id: string): Promise<KioskActionState> {
  await requireRole("manager");
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("kiosk_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { error: "Could not revoke that device." };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }
  revalidatePath("/manage/kiosk");
  return { success: "Device revoked. It can no longer clock anyone on." };
}

const pinSchema = z.object({
  userId: z.string().uuid(),
  pin: z
    .string()
    .regex(/^[0-9]{4,10}$/, "A PIN must be 4 to 10 digits."),
});

/**
 * Set a staff member's kiosk PIN.
 *
 * The PIN is passed straight to a SECURITY DEFINER function that hashes it
 * inside Postgres, so no application code ever holds a hash — and this
 * action never reads one back.
 */
export async function setStaffPin(
  _prev: KioskActionState,
  formData: FormData,
): Promise<KioskActionState> {
  await requireRole("manager");

  const parsed = pinSchema.safeParse({
    userId: formData.get("userId"),
    pin: formData.get("pin"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Guard against the obvious ones. A four-digit PIN is weak enough without
  // it being 1234, and lockout only helps if guessing is not trivial.
  if (/^(\d)\1+$/.test(parsed.data.pin) || "0123456789".includes(parsed.data.pin)) {
    return {
      error: "Choose a less predictable PIN — not repeated or sequential digits.",
    };
  }

  try {
    const admin = createServiceRoleClient();
    const { error } = await admin.rpc("set_kiosk_pin", {
      p_user: parsed.data.userId,
      p_pin: parsed.data.pin,
    });
    if (error) return { error: `Could not set the PIN: ${error.message}` };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }

  revalidatePath("/manage/kiosk");
  return {
    success:
      "PIN set. Tell the staff member in person — it is not shown again and cannot be looked up.",
  };
}

/* ------------------------------------------------------------------ */
/* Kiosk: start a device session, and punch                            */
/* ------------------------------------------------------------------ */

const punchSchema = z.object({
  userId: z.string().uuid(),
  pin: z.string().regex(/^[0-9]{4,10}$/),
  eventType: z.enum(["clock_in", "break_start", "break_end", "clock_out"]),
});

/**
 * Clock a staff member on or off at a kiosk.
 *
 * Every punch re-verifies the PIN. The kiosk cookie authorises the DEVICE,
 * never a person, so nothing here may be done on the strength of the tablet
 * alone — otherwise the next person to walk past could clock a colleague
 * out.
 */
export async function kioskPunch(
  _prev: KioskActionState,
  formData: FormData,
): Promise<KioskActionState> {
  const session = await getKioskSession();
  if (!session) {
    return { error: "This device is no longer authorised. Ask your manager." };
  }

  const parsed = punchSchema.safeParse({
    userId: formData.get("userId"),
    pin: formData.get("pin"),
    eventType: formData.get("eventType"),
  });

  if (!parsed.success) {
    return { error: "Enter your PIN." };
  }

  const { userId, pin, eventType } = parsed.data;

  try {
    const admin = createServiceRoleClient();

    // The person must actually work at this property. Without this, a valid
    // PIN would clock someone on at a motel they have no business at.
    const { data: access } = await admin
      .from("user_property_access")
      .select("user_id")
      .eq("user_id", userId)
      .eq("property_id", session.propertyId)
      .maybeSingle();

    if (!access) {
      return { error: "You are not set up to clock on at this property." };
    }

    const { data: status, error: verifyError } = await admin.rpc(
      "verify_kiosk_pin",
      { p_user: userId, p_pin: pin },
    );

    if (verifyError) {
      return { error: "Could not check that PIN. Try again." };
    }

    if (status === "no_pin") {
      return { error: "No PIN is set for you yet. Ask your manager." };
    }
    if (status === "locked") {
      return {
        error:
          "Too many wrong attempts. This PIN is locked for a while — ask your manager, or clock on from your own phone.",
      };
    }
    if (status !== "ok") {
      return { error: "That PIN is not right." };
    }

    // Same derived-state rule as the app clock, so a kiosk cannot record a
    // second clock-in for someone already on shift.
    const from = new Date();
    from.setHours(from.getHours() - 20);
    const { data: rows } = await admin
      .from("clock_events")
      .select("id, event_type, server_time, shift_id")
      .eq("user_id", userId)
      .gte("server_time", from.toISOString())
      .order("server_time", { ascending: true });

    const events: ClockEvent[] = (rows ?? []).map((r) => ({
      id: String(r.id),
      eventType: String(r.event_type) as ClockEventType,
      serverTime: String(r.server_time),
      shiftId: (r.shift_id as string | null) ?? null,
    }));

    const state = deriveClockState(events);
    if (!isActionAllowed(state.status, eventType)) {
      return { error: "That is not possible from your current state." };
    }

    const clientTime = new Date().toISOString();
    const { error: insertError } = await admin.from("clock_events").insert({
      organisation_id: session.organisationId,
      property_id: session.propertyId,
      user_id: userId,
      shift_id: state.shiftId,
      event_type: eventType,
      client_time: clientTime,
      source: "kiosk" as const,
      device_id: session.id,
      idempotency_key: `kiosk:${session.id}:${userId}:${eventType}:${clientTime}`,
    });

    if (insertError) {
      return { error: `Could not record that: ${insertError.message}` };
    }
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }

  revalidatePath("/kiosk");
  return { success: confirmationFor(eventType) };
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
      return "Clocked out. Thanks for your work today.";
  }
}
