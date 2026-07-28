"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";

/** Result returned to an acknowledgement form. */
export interface AckState {
  error?: string;
  success?: string;
}

const acceptSchema = z.object({
  shiftId: z.string().uuid("That shift could not be identified."),
});

const declineSchema = acceptSchema.extend({
  reason: z
    .string()
    .trim()
    .min(5, "Please give your manager a brief reason.")
    .max(500, "Please keep the reason under 500 characters."),
});

/**
 * Accept a published shift.
 *
 * RLS restricts the update to the caller's own acknowledgement row, so no
 * ownership check is needed here — the database will simply match no rows
 * for anybody else's shift.
 */
export async function acceptShift(
  _prev: AckState,
  formData: FormData,
): Promise<AckState> {
  const parsed = acceptSchema.safeParse({ shiftId: formData.get("shiftId") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  await requireUser();

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("shift_acknowledgements")
      .update({
        status: "accepted",
        responded_at: new Date().toISOString(),
      })
      .eq("shift_id", parsed.data.shiftId);

    if (error) return { error: "Could not record your response." };
  } catch {
    return {
      error: "Cannot reach StayFlow right now. Try again when you have signal.",
    };
  }

  revalidatePath("/roster");
  return { success: "Shift accepted." };
}

/**
 * Decline a published shift.
 *
 * A decline never removes the shift — it records the reason and raises a
 * review item for the manager, who decides what happens to the coverage.
 * Saying otherwise would let a roster silently develop a hole.
 */
export async function declineShift(
  _prev: AckState,
  formData: FormData,
): Promise<AckState> {
  const parsed = declineSchema.safeParse({
    shiftId: formData.get("shiftId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  await requireUser();

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("shift_acknowledgements")
      .update({
        status: "declined",
        decline_reason: parsed.data.reason,
        responded_at: new Date().toISOString(),
      })
      .eq("shift_id", parsed.data.shiftId);

    if (error) return { error: "Could not record your response." };
  } catch {
    return {
      error: "Cannot reach StayFlow right now. Try again when you have signal.",
    };
  }

  revalidatePath("/roster");
  return {
    success:
      "Shift declined. Your manager has been notified and will confirm cover.",
  };
}

/**
 * Mark a shift as viewed.
 *
 * Separate from accepting: management needs to distinguish "has not looked"
 * from "looked and has not decided" when chasing acknowledgements.
 */
export async function markShiftViewed(shiftId: string): Promise<void> {
  await requireUser();
  try {
    const supabase = await createClient();
    await supabase
      .from("shift_acknowledgements")
      .update({ status: "viewed", viewed_at: new Date().toISOString() })
      .eq("shift_id", shiftId)
      .eq("status", "pending");
  } catch {
    // A failed view-stamp must never block the roster from rendering.
  }
}
