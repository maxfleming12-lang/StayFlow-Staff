"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/deliver";
import { requireRole } from "@/lib/auth/session";
import { findConflicts, requiresOverride, type Conflict } from "./conflicts";
import { getConflictContext } from "./manager-queries";
import { localDateTimeToIso } from "./week";

/** Result of a roster mutation. */
export interface RosterActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
  /** Conflicts found. Present whether or not the save went ahead. */
  conflicts?: Conflict[];
  /** True when the caller must resubmit with an override reason. */
  needsOverride?: boolean;
  /**
   * The values that were submitted, echoed back.
   *
   * The conflict path returns WITHOUT saving and re-renders the form to ask
   * for an override reason. Uncontrolled inputs reset to their defaultValue
   * on that re-render, so without echoing these back the manager would
   * acknowledge a warning about one shift and silently save a different
   * one — observed resetting a named staff member to "unassigned" and the
   * date back to the start of the week.
   */
  values?: {
    propertyId?: string;
    userId?: string;
    startsAt?: string;
    endsAt?: string;
    notes?: string;
    requiredRole?: string;
    breakMinutes?: string;
  };
}

const shiftSchema = z
  .object({
    shiftId: z.string().uuid().optional(),
    propertyId: z.string().uuid("Choose a property."),
    userId: z.string().uuid().nullable(),
    startsAt: z.string().min(1, "Choose a start time."),
    endsAt: z.string().min(1, "Choose a finish time."),
    notes: z.string().trim().max(1000).optional(),
    requiredRole: z.string().trim().max(100).optional(),
    breakMinutes: z.number().int().min(0).max(600).optional(),
    breakIsPaid: z.boolean().optional(),
    overrideReason: z.string().trim().max(500).optional(),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    path: ["endsAt"],
    message: "The finish time must be after the start time.",
  });

/** Read a shift form into the validated shape. */
function parseShiftForm(formData: FormData) {
  const rawUser = formData.get("userId");
  const breakRaw = formData.get("breakMinutes");

  return shiftSchema.safeParse({
    shiftId: (formData.get("shiftId") as string) || undefined,
    propertyId: formData.get("propertyId"),
    // An empty selection means an unassigned open shift, not a missing field.
    userId: rawUser && rawUser !== "" ? rawUser : null,
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    notes: (formData.get("notes") as string) || undefined,
    requiredRole: (formData.get("requiredRole") as string) || undefined,
    breakMinutes: breakRaw ? Number(breakRaw) : undefined,
    breakIsPaid: formData.get("breakIsPaid") === "on",
    overrideReason: (formData.get("overrideReason") as string) || undefined,
  });
}

/**
 * Create or update a shift.
 *
 * Conflicts never block outright. When a warning-level conflict is found and
 * no override reason was given, the action returns the conflicts and asks for
 * one; resubmitting with a reason records it against the shift. That mirrors
 * how a motel actually runs — the manager knows things the roster does not.
 */
export async function saveShift(
  _prev: RosterActionState,
  formData: FormData,
): Promise<RosterActionState> {
  const user = await requireRole("manager");

  const parsed = parseShiftForm(formData);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return {
      fieldErrors,
      values: {
        propertyId: (formData.get("propertyId") as string) ?? "",
        userId: (formData.get("userId") as string) ?? "",
        startsAt: (formData.get("startsAt") as string) ?? "",
        endsAt: (formData.get("endsAt") as string) ?? "",
        notes: (formData.get("notes") as string) ?? "",
        requiredRole: (formData.get("requiredRole") as string) ?? "",
        breakMinutes: (formData.get("breakMinutes") as string) ?? "",
      },
    };
  }

  const input = parsed.data;
  const startsAtIso = localDateTimeToIso(input.startsAt);
  const endsAtIso = localDateTimeToIso(input.endsAt);

  // Echoed back on every return path so the form can restore itself.
  const values = {
    propertyId: input.propertyId,
    userId: input.userId ?? "",
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    notes: input.notes ?? "",
    requiredRole: input.requiredRole ?? "",
    breakMinutes: input.breakMinutes != null ? String(input.breakMinutes) : "",
  };

  try {
    let conflicts: Conflict[] = [];

    if (input.userId) {
      const context = await getConflictContext(input.userId, startsAtIso);
      conflicts = findConflicts(
        {
          id: input.shiftId,
          userId: input.userId,
          propertyId: input.propertyId,
          startsAt: startsAtIso,
          endsAt: endsAtIso,
        },
        { ...context, crossPropertyMinimumHours: 12 },
      );

      if (requiresOverride(conflicts) && !input.overrideReason) {
        return {
          conflicts,
          needsOverride: true,
          values,
          error:
            "This shift conflicts with something. Review the warnings and give a reason to roster it anyway.",
        };
      }
    }

    const supabase = await createClient();
    const payload = {
      organisation_id: user.organisationId,
      property_id: input.propertyId,
      user_id: input.userId,
      starts_at: startsAtIso,
      ends_at: endsAtIso,
      notes: input.notes ?? null,
      required_role: input.requiredRole ?? null,
      is_open_shift: input.userId === null,
      override_reason: input.overrideReason ?? null,
      overridden_by: input.overrideReason ? user.id : null,
    };

    // Read the status BEFORE the write, to know whether this shift had
    // already been published to somebody.
    let existingStatus: string | null = null;
    if (input.shiftId) {
      const { data: existing } = await supabase
        .from("shifts")
        .select("status")
        .eq("id", input.shiftId)
        .is("archived_at", null)
        .maybeSingle();

      if (!existing) {
        return {
          error: "That shift no longer exists. It may have been removed.",
          values,
        };
      }
      existingStatus = String(existing.status);
    }

    const { data, error } = input.shiftId
      ? await supabase
          .from("shifts")
          .update(payload)
          .eq("id", input.shiftId)
          .is("archived_at", null)
          .select("id")
          .maybeSingle()
      : await supabase
          .from("shifts")
          .insert({ ...payload, status: "draft", created_by: user.id })
          .select("id")
          .maybeSingle();

    if (error || !data) {
      return {
        error: error?.message ?? "Could not save the shift.",
        conflicts,
        values,
      };
    }

    // Replace breaks wholesale — simpler and less error-prone than diffing,
    // and a shift has at most a handful.
    //
    // The delete runs unconditionally. Guarding it on a non-zero break, as
    // this did while nothing could edit a shift, meant clearing the break on
    // an existing shift silently left the old one in place — the manager saw
    // zero and payroll still deducted thirty minutes.
    await supabase.from("shift_breaks").delete().eq("shift_id", data.id);
    if (input.breakMinutes && input.breakMinutes > 0) {
      await supabase.from("shift_breaks").insert({
        organisation_id: user.organisationId,
        shift_id: data.id,
        duration_minutes: input.breakMinutes,
        is_paid: input.breakIsPaid ?? false,
      });
    }

    // Changing a PUBLISHED shift changes something the staff member has
    // already been told about and may have planned around, so tell them.
    // A draft is not yet visible to them and needs no message.
    if (input.shiftId && input.userId && existingStatus === "published") {
      await supabase
        .from("shift_acknowledgements")
        .update({ status: "pending" })
        .eq("shift_id", input.shiftId)
        .eq("user_id", input.userId);

      await notify({
        organisationId: user.organisationId,
        propertyId: input.propertyId,
        userIds: [input.userId],
        category: "roster_published",
        title: "A shift of yours changed",
        // No times: this can appear on a locked phone.
        body: "One of your rostered shifts has been changed. Open StayFlow to see it.",
        deepLink: "/roster",
      });
    }

    revalidatePath("/manage/roster");
    revalidatePath("/roster");
    return {
      success: input.shiftId ? "Shift updated." : "Shift added to the draft roster.",
      conflicts,
    };
  } catch {
    return {
      error: "Cannot reach StayFlow right now. Try again shortly.",
      values,
    };
  }
}

const removeShiftSchema = z.object({
  shiftId: z.string().uuid(),
});

/**
 * Remove a single shift that nobody is relying on.
 *
 * Soft delete, like everything else here — attendance and audit history
 * reference shifts, so the row stays and `archived_at` is set.
 *
 * Two kinds qualify, and only these two:
 *
 *   * UNFILLED — nobody holds it, so nobody loses a shift. True whether it
 *     is draft or published.
 *   * DRAFT — staff cannot see draft shifts at all (`shifts_select_self`
 *     requires `status = 'published'`), so nothing has been communicated
 *     yet, assigned or not.
 *
 * A published, assigned shift is refused: the person rostered on has been
 * notified and may have arranged their week around it. Removing that is a
 * different, louder operation than this one.
 *
 * The eligibility test is repeated in the WHERE clause of the write so the
 * DATABASE settles the race. The grid renders on the server, so between the
 * page rendering and the manager clicking, a shift may have been assigned,
 * published or removed by someone else; checking first and then writing
 * would leave a window in which a live shift is archived out from under the
 * person rostered on it.
 */
export async function removeShift(
  _prev: RosterActionState,
  formData: FormData,
): Promise<RosterActionState> {
  await requireRole("manager");

  const parsed = removeShiftSchema.safeParse({
    shiftId: formData.get("shiftId"),
  });
  if (!parsed.success) return { error: "That shift could not be identified." };

  try {
    const supabase = await createClient();

    const { data: shift, error: readError } = await supabase
      .from("shifts")
      .select("id, user_id, status, archived_at")
      .eq("id", parsed.data.shiftId)
      .maybeSingle();

    if (readError) return { error: "Could not read that shift." };
    if (!shift) return { error: "That shift could not be found." };
    if (shift.archived_at) return { error: "That shift has already been removed." };

    const unfilled = shift.user_id === null;
    const draft = shift.status === "draft";

    if (!unfilled && !draft) {
      return {
        error:
          "This shift is published and assigned, so it cannot be removed here — the person rostered on has already been told about it.",
      };
    }

    // A claim means a real person is waiting on an answer. Removing the shift
    // would drop their request silently, so say so and let the manager
    // decline it deliberately instead.
    if (unfilled) {
      const { data: claimed } = await supabase
        .from("open_shift_offers")
        .select("id")
        .eq("shift_id", parsed.data.shiftId)
        .eq("status", "claimed")
        .limit(1)
        .maybeSingle();

      if (claimed) {
        return {
          error:
            "Somebody has claimed this shift. Decline their claim first, then remove it.",
        };
      }
    }

    const { data, error } = await supabase
      .from("shifts")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", parsed.data.shiftId)
      .is("archived_at", null)
      .or("user_id.is.null,status.eq.draft")
      .select("id")
      .maybeSingle();

    if (error) return { error: "Could not remove the shift." };
    if (!data) {
      // Nothing matched, so the shift changed under us between the read and
      // the write — it was assigned and published, or already removed.
      return {
        error:
          "That shift changed while you were looking at it. Refresh to see the current roster.",
      };
    }
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }

  revalidatePath("/manage/roster");
  revalidatePath("/roster");
  // A published unfilled shift is listed for staff to pick up.
  revalidatePath("/available-shifts");
  return { success: "Shift removed." };
}

const clearWeekSchema = z.object({
  weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid week."),
  propertyId: z.union([z.string().uuid(), z.literal("")]).optional(),
});

/**
 * Archive every shift and roster period in a displayed week.
 *
 * This is deliberately a soft delete. It lets a manager rebuild a bad roster
 * without breaking attendance, acknowledgement or audit references.
 */
export async function clearRosterWeek(
  _prev: RosterActionState,
  formData: FormData,
): Promise<RosterActionState> {
  const user = await requireRole("administrator");
  const parsed = clearWeekSchema.safeParse({
    weekStartDate: formData.get("weekStartDate"),
    propertyId: (formData.get("propertyId") as string) || "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    const supabase = await createClient();
    const { weekRange } = await import("./week");
    const { fromIso, toIso } = weekRange(parsed.data.weekStartDate);
    const now = new Date().toISOString();

    let shiftQuery = supabase
      .from("shifts")
      .update({ archived_at: now })
      .eq("organisation_id", user.organisationId)
      .gte("starts_at", fromIso)
      .lt("starts_at", toIso)
      .is("archived_at", null);

    let periodQuery = supabase
      .from("roster_periods")
      .update({ archived_at: now })
      .eq("organisation_id", user.organisationId)
      .eq("week_start_date", parsed.data.weekStartDate)
      .eq("is_template", false)
      .is("archived_at", null);

    if (parsed.data.propertyId) {
      shiftQuery = shiftQuery.eq("property_id", parsed.data.propertyId);
      periodQuery = periodQuery.eq("property_id", parsed.data.propertyId);
    }

    const [{ data: shifts, error: shiftError }, { error: periodError }] =
      await Promise.all([
        shiftQuery.select("id"),
        periodQuery.select("id"),
      ]);

    if (shiftError || periodError) {
      return { error: "Could not clear the roster week." };
    }

    revalidatePath("/manage/roster");
    revalidatePath("/roster");
    return {
      success: `Cleared ${shifts?.length ?? 0} shift${shifts?.length === 1 ? "" : "s"}.`,
    };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }
}

const assignShiftSchema = z.object({
  shiftId: z.string().uuid(),
  userId: z.string().uuid("Choose a staff member."),
});

/**
 * Assign an existing open shift without making the manager recreate it.
 * Published shifts remain published and notify the newly rostered person.
 */
export async function assignOpenShift(
  _prev: RosterActionState,
  formData: FormData,
): Promise<RosterActionState> {
  const user = await requireRole("manager");
  const parsed = assignShiftSchema.safeParse({
    shiftId: formData.get("shiftId"),
    userId: formData.get("userId"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: { userId: "Choose a staff member." },
      error: "Choose a staff member.",
    };
  }

  try {
    const supabase = await createClient();
    const { data: shift, error: shiftError } = await supabase
      .from("shifts")
      .select("id, property_id, starts_at, ends_at, status, user_id")
      .eq("id", parsed.data.shiftId)
      .is("archived_at", null)
      .maybeSingle();

    if (shiftError || !shift) {
      return { error: "That shift could not be found." };
    }
    if (shift.user_id) {
      return { error: "That shift has already been assigned." };
    }

    const context = await getConflictContext(
      parsed.data.userId,
      String(shift.starts_at),
    );
    const conflicts = findConflicts(
      {
        id: parsed.data.shiftId,
        userId: parsed.data.userId,
        propertyId: String(shift.property_id),
        startsAt: String(shift.starts_at),
        endsAt: String(shift.ends_at),
      },
      { ...context, crossPropertyMinimumHours: 12 },
    );

    if (requiresOverride(conflicts)) {
      return {
        error:
          "This person has a roster conflict. Use Add shift to review the warnings before assigning them.",
        conflicts,
      };
    }

    const { data: updated, error: updateError } = await supabase
      .from("shifts")
      .update({ user_id: parsed.data.userId, is_open_shift: false })
      .eq("id", parsed.data.shiftId)
      .is("user_id", null)
      .select("id")
      .maybeSingle();

    if (updateError || !updated) {
      return {
        error:
          updateError?.message ?? "That shift was assigned by someone else.",
      };
    }

    if (shift.status === "published") {
      await supabase.from("shift_acknowledgements").upsert(
        {
          organisation_id: user.organisationId,
          shift_id: parsed.data.shiftId,
          user_id: parsed.data.userId,
          status: "pending",
        },
        { onConflict: "shift_id,user_id" },
      );

      await notify({
        organisationId: user.organisationId,
        propertyId: String(shift.property_id),
        userIds: [parsed.data.userId],
        category: "roster_published",
        title: "New shift assigned",
        body: "A shift has been added to your roster.",
        deepLink: "/roster",
      });
    }

    revalidatePath("/manage/roster");
    revalidatePath("/roster");
    return { success: "Shift assigned." };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }
}

const publishSchema = z.object({
  weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid week."),
  propertyId: z.string().uuid("Choose a property."),
  message: z.string().trim().max(500).optional(),
  requireAck: z.boolean().optional(),
});

/**
 * Publish every draft shift in a week for one property.
 *
 * Publishing records who did it and when, creates an acknowledgement row per
 * assigned shift when acknowledgement is required, and notifies the affected
 * staff. Until the notification system lands, the in-app notification row is
 * still written so nothing is lost.
 */
export async function publishRoster(
  _prev: RosterActionState,
  formData: FormData,
): Promise<RosterActionState> {
  const user = await requireRole("manager");

  const parsed = publishSchema.safeParse({
    weekStartDate: formData.get("weekStartDate"),
    propertyId: formData.get("propertyId"),
    message: (formData.get("message") as string) || undefined,
    requireAck: formData.get("requireAck") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { weekStartDate, propertyId, message, requireAck } = parsed.data;
  const now = new Date().toISOString();

  try {
    const supabase = await createClient();
    const { weekRange } = await import("./week");
    const { fromIso, toIso } = weekRange(weekStartDate);

    // Record the roster period first, so published_at and published_by are
    // captured even if a later step fails.
    //
    // Deliberately not an upsert: the uniqueness of (property, week) is a
    // PARTIAL index — it excludes templates, which have no week, and
    // archived rows, which should not block a fresh publish. ON CONFLICT
    // cannot infer a partial index, so this looks the row up explicitly.
    const { data: existing } = await supabase
      .from("roster_periods")
      .select("id")
      .eq("property_id", propertyId)
      .eq("week_start_date", weekStartDate)
      .eq("is_template", false)
      .is("archived_at", null)
      .maybeSingle();

    const periodFields = {
      status: "published" as const,
      published_at: now,
      published_by: user.id,
      publish_message: message ?? null,
      requires_ack: requireAck ?? true,
    };

    const { data: period, error: periodError } = existing
      ? await supabase
          .from("roster_periods")
          .update(periodFields)
          .eq("id", existing.id)
          .select("id")
          .maybeSingle()
      : await supabase
          .from("roster_periods")
          .insert({
            organisation_id: user.organisationId,
            property_id: propertyId,
            week_start_date: weekStartDate,
            created_by: user.id,
            ...periodFields,
          })
          .select("id")
          .maybeSingle();

    if (periodError) {
      return { error: `Could not publish: ${periodError.message}` };
    }

    const { data: published, error: shiftError } = await supabase
      .from("shifts")
      .update({
        status: "published",
        published_at: now,
        published_by: user.id,
        roster_period_id: period?.id ?? null,
      })
      .eq("property_id", propertyId)
      .eq("status", "draft")
      .gte("starts_at", fromIso)
      .lt("starts_at", toIso)
      .is("archived_at", null)
      .select("id, user_id");

    if (shiftError) {
      return { error: `Could not publish the shifts: ${shiftError.message}` };
    }

    const assigned = (published ?? []).filter((s) => s.user_id);

    if (requireAck !== false && assigned.length > 0) {
      await supabase.from("shift_acknowledgements").upsert(
        assigned.map((s) => ({
          organisation_id: user.organisationId,
          shift_id: s.id,
          user_id: s.user_id as string,
          status: "pending",
        })),
        { onConflict: "shift_id,user_id" },
      );
    }

    // One notification per affected person, not per shift — someone with
    // five new shifts wants one message, not five.
    const affected = [...new Set(assigned.map((s) => s.user_id as string))];
    if (affected.length > 0) {
      const { formatWeekLabel } = await import("./week");
      const result = await notify({
        organisationId: user.organisationId,
        propertyId,
        userIds: affected,
        category: "roster_published",
        title: "Roster published",
        // Free of times, names and pay — this can appear on a locked phone.
        body: `Your roster for ${formatWeekLabel(weekStartDate)} has been published.`,
        deepLink: "/roster",
      });

      if (result.error) {
        return {
          success: `Published ${published?.length ?? 0} shift(s), but staff could not be notified: ${result.error}`,
        };
      }
    }

    revalidatePath("/manage/roster");
    revalidatePath("/roster");

    return {
      success:
        published && published.length > 0
          ? `Published ${published.length} shift${published.length === 1 ? "" : "s"} to ${affected.length} staff member${affected.length === 1 ? "" : "s"}.`
          : "No draft shifts to publish for that week.",
    };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }
}
