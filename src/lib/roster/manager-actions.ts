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

    const { data, error } = input.shiftId
      ? await supabase
          .from("shifts")
          .update(payload)
          .eq("id", input.shiftId)
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
    if (input.breakMinutes && input.breakMinutes > 0) {
      await supabase.from("shift_breaks").delete().eq("shift_id", data.id);
      await supabase.from("shift_breaks").insert({
        organisation_id: user.organisationId,
        shift_id: data.id,
        duration_minutes: input.breakMinutes,
        is_paid: input.breakIsPaid ?? false,
      });
    }

    revalidatePath("/manage/roster");
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

/**
 * Archive a shift.
 *
 * Soft delete: attendance and audit history reference shifts, so removing
 * the row outright would orphan them.
 */
export async function deleteShift(shiftId: string): Promise<RosterActionState> {
  await requireRole("manager");

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("shifts")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", shiftId);

    if (error) return { error: "Could not remove the shift." };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }

  revalidatePath("/manage/roster");
  return { success: "Shift removed." };
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
