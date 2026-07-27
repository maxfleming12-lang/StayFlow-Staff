"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { copyWeekShifts } from "./copy";
import { weekRange } from "./week";

export interface TemplateActionState {
  error?: string;
  success?: string;
  /** Set when the copy landed but something needs saying about it. */
  warning?: string;
}

/** Shift columns worth carrying to a copy. */
const COPY_FIELDS = `id, property_id, user_id, team_id, starts_at, ends_at,
  notes, required_role, is_open_shift`;

/**
 * Load a week's shifts and re-anchor them onto another week.
 *
 * Shared by "duplicate week" and "apply template" — the same operation from
 * the caller's point of view, differing only in where the source comes from.
 *
 * Copies land as DRAFT regardless of the source's status. Duplicating a
 * published week must not silently publish the new one: staff would receive
 * notifications for a roster the manager had not finished.
 */
async function copyShiftsBetweenWeeks(options: {
  sourceWeek: string;
  targetWeek: string;
  propertyId: string;
  /** Restrict the source to one roster period, for templates. */
  sourcePeriodId?: string;
  actorId: string;
  organisationId: string;
}): Promise<TemplateActionState> {
  const supabase = await createClient();
  const { fromIso, toIso } = weekRange(options.sourceWeek);

  let sourceQuery = supabase
    .from("shifts")
    .select(COPY_FIELDS)
    .eq("property_id", options.propertyId)
    .is("archived_at", null)
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso);

  if (options.sourcePeriodId) {
    sourceQuery = sourceQuery.eq("roster_period_id", options.sourcePeriodId);
  }

  const { data: sourceShifts, error: readError } = await sourceQuery;
  if (readError) {
    return { error: `Could not read the source week: ${readError.message}` };
  }
  if (!sourceShifts || sourceShifts.length === 0) {
    return { error: "There are no shifts to copy from that week." };
  }

  // Refuse to double up rather than silently creating a second copy.
  const target = weekRange(options.targetWeek);
  const { count: existingCount, error: countError } = await supabase
    .from("shifts")
    .select("id", { count: "exact", head: true })
    .eq("property_id", options.propertyId)
    .is("archived_at", null)
    .gte("starts_at", target.fromIso)
    .lt("starts_at", target.toIso);

  if (countError) {
    return { error: `Could not check the target week: ${countError.message}` };
  }
  if ((existingCount ?? 0) > 0) {
    return {
      error: `That week already has ${existingCount} shift${existingCount === 1 ? "" : "s"}. Remove them first, or choose an empty week.`,
    };
  }

  const { copied, skipped } = copyWeekShifts(
    sourceShifts.map((s) => ({
      id: String(s.id),
      startsAt: String(s.starts_at),
      endsAt: String(s.ends_at),
    })),
    options.sourceWeek,
    options.targetWeek,
  );

  if (copied.length === 0) {
    return { error: "None of those shifts fell inside the source week." };
  }

  const byId = new Map(sourceShifts.map((s) => [String(s.id), s]));

  const { error: insertError } = await supabase.from("shifts").insert(
    copied.map((c) => {
      const source = byId.get(c.sourceId)!;
      return {
        organisation_id: options.organisationId,
        property_id: String(source.property_id),
        user_id: (source.user_id as string | null) ?? null,
        team_id: (source.team_id as string | null) ?? null,
        starts_at: c.startsAt,
        ends_at: c.endsAt,
        notes: (source.notes as string | null) ?? null,
        required_role: (source.required_role as string | null) ?? null,
        is_open_shift: Boolean(source.is_open_shift),
        // Always draft — see the note above.
        status: "draft" as const,
        created_by: options.actorId,
      };
    }),
  );

  if (insertError) {
    return { error: `Could not create the shifts: ${insertError.message}` };
  }

  revalidatePath("/manage/roster");

  return {
    success: `Copied ${copied.length} shift${copied.length === 1 ? "" : "s"} as a draft roster.`,
    warning:
      skipped.length > 0
        ? `${skipped.length} shift${skipped.length === 1 ? "" : "s"} sat outside the source week and were not copied.`
        : undefined,
  };
}

const copyWeekSchema = z.object({
  sourceWeek: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  targetWeek: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  propertyId: z.string().uuid("Choose a property."),
});

/** Duplicate a week's roster onto another week, as a draft. */
export async function copyWeek(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const user = await requireRole("manager");

  const parsed = copyWeekSchema.safeParse({
    sourceWeek: formData.get("sourceWeek"),
    targetWeek: formData.get("targetWeek"),
    propertyId: formData.get("propertyId"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  if (parsed.data.sourceWeek === parsed.data.targetWeek) {
    return { error: "Choose a different week to copy into." };
  }

  try {
    return await copyShiftsBetweenWeeks({
      ...parsed.data,
      actorId: user.id,
      organisationId: user.organisationId,
    });
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }
}

const saveTemplateSchema = z.object({
  weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  propertyId: z.string().uuid("Choose a property."),
  name: z
    .string()
    .trim()
    .min(2, "Give the template a name.")
    .max(100, "Keep the name under 100 characters."),
});

/**
 * Save a week's shape as a reusable template.
 *
 * The template is a roster_periods row flagged `is_template`, keeping the
 * week it was captured from as its reference. Applying it later re-anchors
 * those shifts onto the chosen week, which is why the reference week is
 * retained rather than discarded.
 */
export async function saveWeekAsTemplate(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const user = await requireRole("manager");

  const parsed = saveTemplateSchema.safeParse({
    weekStartDate: formData.get("weekStartDate"),
    propertyId: formData.get("propertyId"),
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { weekStartDate, propertyId, name } = parsed.data;

  try {
    const supabase = await createClient();
    const { fromIso, toIso } = weekRange(weekStartDate);

    const { data: sourceShifts, error: readError } = await supabase
      .from("shifts")
      .select(COPY_FIELDS)
      .eq("property_id", propertyId)
      .is("archived_at", null)
      .gte("starts_at", fromIso)
      .lt("starts_at", toIso);

    if (readError) {
      return { error: `Could not read that week: ${readError.message}` };
    }
    if (!sourceShifts || sourceShifts.length === 0) {
      return { error: "That week has no shifts to save." };
    }

    const { data: period, error: periodError } = await supabase
      .from("roster_periods")
      .insert({
        organisation_id: user.organisationId,
        property_id: propertyId,
        week_start_date: weekStartDate,
        status: "draft" as const,
        is_template: true,
        template_name: name,
        created_by: user.id,
      })
      .select("id")
      .maybeSingle();

    if (periodError || !period) {
      return {
        error: `Could not save the template: ${periodError?.message ?? "unknown error"}`,
      };
    }

    // Copies of the week's shifts, owned by the template rather than moving
    // the originals — the real roster must be left exactly as it was.
    const { error: copyError } = await supabase.from("shifts").insert(
      sourceShifts.map((s) => ({
        organisation_id: user.organisationId,
        property_id: String(s.property_id),
        user_id: (s.user_id as string | null) ?? null,
        team_id: (s.team_id as string | null) ?? null,
        starts_at: String(s.starts_at),
        ends_at: String(s.ends_at),
        notes: (s.notes as string | null) ?? null,
        required_role: (s.required_role as string | null) ?? null,
        is_open_shift: Boolean(s.is_open_shift),
        status: "draft" as const,
        roster_period_id: period.id,
        // Archived immediately so template shifts never appear on a real
        // roster, a staff member's screen, or a labour-cost total. They are
        // read back explicitly by roster_period_id when the template is used.
        archived_at: new Date().toISOString(),
        created_by: user.id,
      })),
    );

    if (copyError) {
      return { error: `Could not save the template shifts: ${copyError.message}` };
    }

    revalidatePath("/manage/roster");
    return {
      success: `Saved "${name}" as a template with ${sourceShifts.length} shift${sourceShifts.length === 1 ? "" : "s"}.`,
    };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }
}

const applyTemplateSchema = z.object({
  templateId: z.string().uuid("Choose a template."),
  targetWeek: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Apply a saved template to a week, as a draft roster. */
export async function applyTemplate(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const user = await requireRole("manager");

  const parsed = applyTemplateSchema.safeParse({
    templateId: formData.get("templateId"),
    targetWeek: formData.get("targetWeek"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    const supabase = await createClient();

    const { data: template, error: templateError } = await supabase
      .from("roster_periods")
      .select("id, property_id, week_start_date, template_name")
      .eq("id", parsed.data.templateId)
      .eq("is_template", true)
      .is("archived_at", null)
      .maybeSingle();

    if (templateError || !template) {
      return { error: "That template is no longer available." };
    }

    // Template shifts are archived by design, so read them explicitly.
    const { fromIso, toIso } = weekRange(String(template.week_start_date));
    const { data: templateShifts, error: shiftError } = await supabase
      .from("shifts")
      .select(COPY_FIELDS)
      .eq("roster_period_id", template.id)
      .gte("starts_at", fromIso)
      .lt("starts_at", toIso);

    if (shiftError) {
      return { error: `Could not read the template: ${shiftError.message}` };
    }
    if (!templateShifts || templateShifts.length === 0) {
      return { error: "That template has no shifts in it." };
    }

    const target = weekRange(parsed.data.targetWeek);
    const { count: existingCount } = await supabase
      .from("shifts")
      .select("id", { count: "exact", head: true })
      .eq("property_id", String(template.property_id))
      .is("archived_at", null)
      .gte("starts_at", target.fromIso)
      .lt("starts_at", target.toIso);

    if ((existingCount ?? 0) > 0) {
      return {
        error: `That week already has ${existingCount} shift${existingCount === 1 ? "" : "s"}. Remove them first, or choose an empty week.`,
      };
    }

    const { copied, skipped } = copyWeekShifts(
      templateShifts.map((s) => ({
        id: String(s.id),
        startsAt: String(s.starts_at),
        endsAt: String(s.ends_at),
      })),
      String(template.week_start_date),
      parsed.data.targetWeek,
    );

    if (copied.length === 0) {
      return { error: "That template produced no usable shifts." };
    }

    const byId = new Map(templateShifts.map((s) => [String(s.id), s]));

    const { error: insertError } = await supabase.from("shifts").insert(
      copied.map((c) => {
        const source = byId.get(c.sourceId)!;
        return {
          organisation_id: user.organisationId,
          property_id: String(source.property_id),
          user_id: (source.user_id as string | null) ?? null,
          team_id: (source.team_id as string | null) ?? null,
          starts_at: c.startsAt,
          ends_at: c.endsAt,
          notes: (source.notes as string | null) ?? null,
          required_role: (source.required_role as string | null) ?? null,
          is_open_shift: Boolean(source.is_open_shift),
          status: "draft" as const,
          created_by: user.id,
        };
      }),
    );

    if (insertError) {
      return { error: `Could not create the shifts: ${insertError.message}` };
    }

    revalidatePath("/manage/roster");
    return {
      success: `Applied "${template.template_name}" — ${copied.length} draft shift${copied.length === 1 ? "" : "s"} created.`,
      warning:
        skipped.length > 0
          ? `${skipped.length} template shift${skipped.length === 1 ? "" : "s"} could not be placed.`
          : undefined,
    };
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
  }
}

/** Remove a saved template. Its archived shift copies go with it. */
export async function deleteTemplate(
  templateId: string,
): Promise<TemplateActionState> {
  await requireRole("manager");
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("roster_periods")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", templateId)
      .eq("is_template", true);

    if (error) return { error: "Could not remove that template." };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }
  revalidatePath("/manage/roster");
  return { success: "Template removed." };
}

/** Templates available for a property. */
export async function getTemplates(propertyId?: string) {
  await requireRole("manager");
  const supabase = await createClient();

  let query = supabase
    .from("roster_periods")
    .select("id, template_name, property_id, week_start_date")
    .eq("is_template", true)
    .is("archived_at", null)
    .order("template_name", { ascending: true });

  if (propertyId) query = query.eq("property_id", propertyId);

  const { data, error } = await query;
  if (error) return [];

  return (data ?? []).map((t) => ({
    id: String(t.id),
    name: String(t.template_name ?? "Untitled template"),
    propertyId: String(t.property_id),
  }));
}
