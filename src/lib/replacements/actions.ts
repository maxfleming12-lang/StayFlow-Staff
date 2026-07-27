"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth/session";

export interface ReplacementActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Staff: request a replacement                                        */
/* ------------------------------------------------------------------ */

const requestSchema = z.object({
  shiftId: z.string().uuid("That shift could not be identified."),
  reason: z
    .string()
    .trim()
    .min(5, "Give your manager a brief reason.")
    .max(500, "Please keep the reason under 500 characters."),
});

/**
 * Ask to be replaced on a shift.
 *
 * The shift stays assigned to the requester throughout. Nothing is removed
 * from the roster until a manager approves a replacement, so a request that
 * nobody picks up leaves the shift covered rather than quietly vacant.
 */
export async function requestReplacement(
  _prev: ReplacementActionState,
  formData: FormData,
): Promise<ReplacementActionState> {
  const user = await requireUser();

  const parsed = requestSchema.safeParse({
    shiftId: formData.get("shiftId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    const supabase = await createClient();

    // RLS also enforces that the shift is theirs; checking here produces a
    // sensible message rather than a policy violation.
    const { data: shift } = await supabase
      .from("shifts")
      .select("id, user_id, organisation_id")
      .eq("id", parsed.data.shiftId)
      .maybeSingle();

    if (!shift || shift.user_id !== user.id) {
      return { error: "That shift is not yours to hand over." };
    }

    const { data: existing } = await supabase
      .from("shift_replacement_requests")
      .select("id")
      .eq("shift_id", parsed.data.shiftId)
      .in("status", ["requested", "offered", "claimed"])
      .maybeSingle();

    if (existing) {
      return { error: "You have already asked to be replaced on this shift." };
    }

    const { error } = await supabase
      .from("shift_replacement_requests")
      .insert({
        organisation_id: user.organisationId,
        shift_id: parsed.data.shiftId,
        requested_by: user.id,
        reason: parsed.data.reason,
        status: "requested",
      });

    if (error) return { error: `Could not send the request: ${error.message}` };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }

  revalidatePath("/roster");
  revalidatePath("/manage/replacements");
  return {
    success:
      "Request sent. You are still rostered on this shift until your manager arranges cover.",
  };
}

/** Withdraw a request. The database restricts staff to this one change. */
export async function withdrawReplacement(
  id: string,
): Promise<ReplacementActionState> {
  await requireUser();
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("shift_replacement_requests")
      .update({ status: "withdrawn" })
      .eq("id", id);
    if (error) return { error: error.message };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }
  revalidatePath("/roster");
  return { success: "Request withdrawn. The shift remains yours." };
}

/* ------------------------------------------------------------------ */
/* Manager: offer, approve, reject                                     */
/* ------------------------------------------------------------------ */

const offerSchema = z.object({
  id: z.string().uuid(),
  /** Empty means offer to every eligible staff member. */
  offerTo: z.array(z.string().uuid()).optional(),
});

/**
 * Offer a shift to staff.
 *
 * With no recipients selected the shift is offered to everyone eligible,
 * represented by a single row with a NULL offered_to_user_id rather than one
 * row per person — otherwise the offer list grows with the workforce and
 * "offered to all" becomes indistinguishable from "offered to these twelve".
 */
export async function offerReplacement(
  _prev: ReplacementActionState,
  formData: FormData,
): Promise<ReplacementActionState> {
  const user = await requireRole("manager");

  const parsed = offerSchema.safeParse({
    id: formData.get("id"),
    offerTo: formData.getAll("offerTo").filter(Boolean) as string[],
  });

  if (!parsed.success) {
    return { error: "That request could not be identified." };
  }

  try {
    const supabase = await createClient();

    const { data: request, error: readError } = await supabase
      .from("shift_replacement_requests")
      .select("id, shift_id, status, organisation_id")
      .eq("id", parsed.data.id)
      .maybeSingle();

    if (readError || !request) {
      return { error: "That request is no longer available." };
    }

    const recipients = parsed.data.offerTo ?? [];

    // A single NULL-targeted row means "everyone eligible"; otherwise one
    // row per named recipient. Typed as one array so the null case does not
    // narrow the element type.
    const offerRows: {
      organisation_id: string;
      shift_id: string;
      offered_to_user_id: string | null;
      status: "offered";
      created_by: string;
    }[] =
      recipients.length > 0
        ? recipients.map((uid) => ({
            organisation_id: request.organisation_id,
            shift_id: request.shift_id,
            offered_to_user_id: uid,
            status: "offered" as const,
            created_by: user.id,
          }))
        : [
            {
              organisation_id: request.organisation_id,
              shift_id: request.shift_id,
              offered_to_user_id: null,
              status: "offered" as const,
              created_by: user.id,
            },
          ];

    const { error: offerError } = await supabase
      .from("open_shift_offers")
      .insert(offerRows);

    if (offerError) {
      return { error: `Could not offer the shift: ${offerError.message}` };
    }

    const { error: statusError } = await supabase
      .from("shift_replacement_requests")
      .update({ status: "offered" })
      .eq("id", parsed.data.id);

    if (statusError) return { error: statusError.message };

    // Notify the people who can actually take it.
    const admin = createServiceRoleClient();
    const targets =
      recipients.length > 0
        ? recipients
        : await eligibleUserIds(request.shift_id);

    if (targets.length > 0) {
      await admin.from("notifications").insert(
        targets.map((uid) => ({
          organisation_id: request.organisation_id,
          user_id: uid,
          category: "open_shift" as const,
          title: "A shift is available",
          body: "A shift needs cover. Open StayFlow to see it.",
          deep_link: "/available-shifts",
        })),
      );
    }

    revalidatePath("/manage/replacements");
    revalidatePath("/available-shifts");
    return {
      success:
        recipients.length > 0
          ? `Offered to ${recipients.length} staff member${recipients.length === 1 ? "" : "s"}.`
          : "Offered to all eligible staff.",
    };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }
}

/** Everyone with access to the shift's property, excluding its current holder. */
async function eligibleUserIds(shiftId: string): Promise<string[]> {
  const admin = createServiceRoleClient();
  const { data: shift } = await admin
    .from("shifts")
    .select("property_id, user_id")
    .eq("id", shiftId)
    .maybeSingle();

  if (!shift) return [];

  const { data: access } = await admin
    .from("user_property_access")
    .select("user_id")
    .eq("property_id", shift.property_id);

  return (access ?? [])
    .map((a) => String(a.user_id))
    .filter((id) => id !== shift.user_id);
}

/* ------------------------------------------------------------------ */
/* Staff: claim an offered shift                                       */
/* ------------------------------------------------------------------ */

/**
 * Claim an open or offered shift.
 *
 * A claim is provisional. The shift is NOT reassigned here — that happens
 * only on manager approval, or immediately when the organisation has
 * auto-approval switched on. `guard_open_shift_approval` independently
 * prevents a staff member from approving their own claim.
 */
export async function claimShift(
  offerId: string,
): Promise<ReplacementActionState> {
  const user = await requireUser();

  try {
    const supabase = await createClient();

    const { data: offer, error } = await supabase
      .from("open_shift_offers")
      .update({
        claimed_by: user.id,
        claimed_at: new Date().toISOString(),
        status: "claimed",
      })
      .eq("id", offerId)
      .select("id, shift_id, organisation_id")
      .maybeSingle();

    if (error) return { error: error.message };
    if (!offer) return { error: "That shift is no longer available." };

    // Mirror the claim onto the replacement request.
    //
    // Written with the service-role client deliberately: the claimant is
    // neither the requester nor a manager, so their own credentials match
    // ZERO rows on this table and the update silently does nothing — the
    // manager's queue would keep showing "offered" with no claimant, and
    // there would be nobody to approve. RLS has already authorised the
    // claim itself on open_shift_offers; this is the system keeping the two
    // tables consistent afterwards.
    const admin = createServiceRoleClient();
    const { error: linkError } = await admin
      .from("shift_replacement_requests")
      .update({ status: "claimed", replacement_user_id: user.id })
      .eq("shift_id", offer.shift_id)
      .eq("status", "offered");

    if (linkError) {
      return {
        error: `Your claim was recorded but your manager was not told: ${linkError.message}`,
      };
    }

    const { data: settings } = await supabase
      .from("organisation_settings")
      .select("auto_approve_open_shifts")
      .maybeSingle();

    if (settings?.auto_approve_open_shifts) {
      const result = await assignShift(offer.shift_id, user.id, user.id);
      if (result.error) return result;
      revalidatePath("/available-shifts");
      revalidatePath("/roster");
      return { success: "Shift claimed and added to your roster." };
    }

    revalidatePath("/available-shifts");
    return {
      success:
        "Claim submitted. Your manager will confirm before it appears on your roster.",
    };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }
}

/* ------------------------------------------------------------------ */
/* Manager: approve or reject                                          */
/* ------------------------------------------------------------------ */

/**
 * Move a shift to its new holder.
 *
 * Reassignment is the whole point of a replacement — recording an approval
 * without changing `shifts.user_id` would leave the original person still
 * rostered while everyone believed it was covered. The old acknowledgement
 * is cleared and a fresh one created, so the new holder is asked to confirm
 * rather than inheriting somebody else's acceptance.
 */
async function assignShift(
  shiftId: string,
  newUserId: string,
  actorId: string,
): Promise<ReplacementActionState> {
  const admin = createServiceRoleClient();

  const { data: shift, error } = await admin
    .from("shifts")
    .update({ user_id: newUserId, is_open_shift: false })
    .eq("id", shiftId)
    .select("id, organisation_id, property_id, starts_at")
    .maybeSingle();

  if (error || !shift) {
    return { error: "Could not move the shift to its new holder." };
  }

  await admin.from("shift_acknowledgements").delete().eq("shift_id", shiftId);
  await admin.from("shift_acknowledgements").insert({
    organisation_id: shift.organisation_id,
    shift_id: shiftId,
    user_id: newUserId,
    status: "pending",
  });

  await admin.from("notifications").insert({
    organisation_id: shift.organisation_id,
    property_id: shift.property_id,
    user_id: newUserId,
    category: "replacement_update" as const,
    title: "Shift confirmed",
    body: "A shift has been added to your roster. Open StayFlow to review it.",
    deep_link: "/roster",
  });

  void actorId;
  return { success: "Shift reassigned." };
}

const decideSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  managerNote: z.string().trim().max(500).optional(),
});

/** Approve the claimed replacement, or reject the request outright. */
export async function decideReplacement(
  _prev: ReplacementActionState,
  formData: FormData,
): Promise<ReplacementActionState> {
  const user = await requireRole("manager");

  const parsed = decideSchema.safeParse({
    id: formData.get("id"),
    decision: formData.get("decision"),
    managerNote: (formData.get("managerNote") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: "That request could not be identified." };
  }

  const { id, decision, managerNote } = parsed.data;

  try {
    const supabase = await createClient();

    const { data: request } = await supabase
      .from("shift_replacement_requests")
      .select("id, shift_id, status, replacement_user_id, requested_by, organisation_id")
      .eq("id", id)
      .maybeSingle();

    if (!request) return { error: "That request is no longer available." };

    if (decision === "approved" && !request.replacement_user_id) {
      return {
        error: "Nobody has claimed this shift yet, so there is no one to approve.",
      };
    }

    const { error: updateError } = await supabase
      .from("shift_replacement_requests")
      .update({
        status: decision,
        manager_note: managerNote ?? null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);

    // The transition guard raises rather than matching zero rows.
    if (updateError) return { error: updateError.message };

    if (decision === "approved" && request.replacement_user_id) {
      const result = await assignShift(
        request.shift_id,
        request.replacement_user_id,
        user.id,
      );
      if (result.error) return result;
    }

    const admin = createServiceRoleClient();
    await admin.from("notifications").insert({
      organisation_id: request.organisation_id,
      user_id: request.requested_by,
      category: "replacement_update" as const,
      title:
        decision === "approved" ? "Cover arranged" : "Replacement not approved",
      body:
        decision === "approved"
          ? "Your shift has been handed over. Open StayFlow to check your roster."
          : "Your replacement request was not approved. You are still rostered.",
      deep_link: "/roster",
    });

    revalidatePath("/manage/replacements");
    revalidatePath("/roster");
    return {
      success:
        decision === "approved"
          ? "Replacement approved and the shift reassigned."
          : "Request declined. The original staff member is still rostered.",
    };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }
}
