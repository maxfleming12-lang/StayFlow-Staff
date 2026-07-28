"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";

export interface CalendarActionState {
  error?: string;
  success?: string;
}

/**
 * Generate a calendar subscription token.
 *
 * 32 random bytes, base64url-encoded. A calendar client cannot authenticate,
 * so this token IS the credential for the feed — it must be long enough that
 * guessing is hopeless, and it must come from a CSPRNG rather than
 * Math.random or a uuid, which are not designed to resist prediction.
 *
 * Any existing token is revoked first, so "regenerate" genuinely invalidates
 * the old URL rather than leaving two working feeds behind.
 */
export async function generateCalendarToken(): Promise<CalendarActionState> {
  const user = await requireUser();

  try {
    const supabase = await createClient();

    const { error: revokeError } = await supabase
      .from("calendar_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("revoked_at", null);

    if (revokeError) {
      return { error: "Could not replace your existing calendar link." };
    }

    const token = randomBytes(32).toString("base64url");

    const { error } = await supabase.from("calendar_tokens").insert({
      organisation_id: user.organisationId,
      user_id: user.id,
      token,
    });

    if (error) return { error: "Could not create a calendar link." };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }

  revalidatePath("/settings");
  return { success: "Calendar link created." };
}

/** Revoke the current token. Any subscribed calendar stops updating. */
export async function revokeCalendarToken(): Promise<CalendarActionState> {
  const user = await requireUser();

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("calendar_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("revoked_at", null);

    if (error) return { error: "Could not revoke the calendar link." };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }

  revalidatePath("/settings");
  return { success: "Calendar link revoked. Subscribed calendars will stop updating." };
}

/** The caller's active token, or null. Used to render the subscribe URL. */
export async function getMyCalendarToken(): Promise<string | null> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("calendar_tokens")
    .select("token")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data?.token ?? null;
}
