"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { CATEGORY_LABELS } from "./policy";
import type { Database } from "@/types/database";

type Category = Database["public"]["Enums"]["notification_category"];

/**
 * Narrow untrusted form values to real categories.
 *
 * The form posts whatever the browser sends, so anything unrecognised is
 * dropped rather than stored — a bogus value would sit in the array forever
 * and could never match a real notification.
 */
function parseCategories(values: string[]): Category[] {
  const known = new Set(Object.keys(CATEGORY_LABELS));
  return values.filter((v) => known.has(v)) as Category[];
}

export interface NotificationSettingsState {
  error?: string;
  success?: string;
}

const subscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  p256dh: z.string().min(1).max(500),
  auth: z.string().min(1).max(500),
  deviceLabel: z.string().trim().max(100).optional(),
  userAgent: z.string().max(500).optional(),
});

/**
 * Store a Web Push subscription for this device.
 *
 * The endpoint and keys are write-only from the client's point of view: RLS
 * lets somebody manage their own subscriptions but gives management no read
 * access at all, because those keys can be used to send that person
 * notifications.
 */
export async function savePushSubscription(
  input: unknown,
): Promise<NotificationSettingsState> {
  const user = await requireUser();

  const parsed = subscribeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "That subscription could not be stored." };
  }

  try {
    const supabase = await createClient();

    // The browser may hand back the same endpoint after a re-subscribe, so
    // replace rather than accumulate dead rows for one device.
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", parsed.data.endpoint);

    const { error } = await supabase.from("push_subscriptions").insert({
      organisation_id: user.organisationId,
      user_id: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.p256dh,
      auth_key: parsed.data.auth,
      device_label: parsed.data.deviceLabel ?? null,
      user_agent: parsed.data.userAgent ?? null,
    });

    if (error) return { error: "Could not turn on notifications." };

    // A subscription is what actually enables delivery, so record the
    // intent alongside it.
    await supabase
      .from("notification_preferences")
      .upsert(
        {
          organisation_id: user.organisationId,
          user_id: user.id,
          push_enabled: true,
        },
        { onConflict: "user_id" },
      );
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }

  revalidatePath("/settings");
  return { success: "Notifications are on for this device." };
}

/** Remove this device's subscription. */
export async function removePushSubscription(
  endpoint: string,
): Promise<NotificationSettingsState> {
  await requireUser();
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint);
    if (error) return { error: "Could not turn notifications off." };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }
  revalidatePath("/settings");
  return { success: "Notifications are off for this device." };
}

const preferencesSchema = z.object({
  mutedCategories: z.array(z.string().max(60)).max(30),
  quietHoursStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .or(z.literal("")),
  quietHoursEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .or(z.literal("")),
});

/** Save muted categories and quiet hours. */
export async function saveNotificationPreferences(
  _prev: NotificationSettingsState,
  formData: FormData,
): Promise<NotificationSettingsState> {
  const user = await requireUser();

  const parsed = preferencesSchema.safeParse({
    mutedCategories: formData.getAll("muted").map(String),
    quietHoursStart: (formData.get("quietHoursStart") as string) || "",
    quietHoursEnd: (formData.get("quietHoursEnd") as string) || "",
  });

  if (!parsed.success) {
    return { error: "Those settings could not be saved." };
  }

  const start = parsed.data.quietHoursStart || null;
  const end = parsed.data.quietHoursEnd || null;

  // Both or neither: half a window is ambiguous, and silently guessing the
  // other half would mute someone at a time they never chose.
  if ((start && !end) || (end && !start)) {
    return { error: "Set both a start and an end for quiet hours, or neither." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("notification_preferences").upsert(
      {
        organisation_id: user.organisationId,
        user_id: user.id,
        muted_categories: parseCategories(parsed.data.mutedCategories),
        quiet_hours_start: start,
        quiet_hours_end: end,
      },
      { onConflict: "user_id" },
    );

    if (error) return { error: `Could not save: ${error.message}` };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }

  revalidatePath("/settings");
  return { success: "Notification settings saved." };
}

/** The signed-in user's preferences, or null when never set. */
export async function getMyNotificationPreferences() {
  await requireUser();
  const supabase = await createClient();

  const [prefRes, subRes] = await Promise.all([
    supabase
      .from("notification_preferences")
      .select("push_enabled, muted_categories, quiet_hours_start, quiet_hours_end")
      .maybeSingle(),
    supabase.from("push_subscriptions").select("endpoint, device_label"),
  ]);

  return {
    preferences: prefRes.data
      ? {
          pushEnabled: prefRes.data.push_enabled ?? true,
          mutedCategories: (prefRes.data.muted_categories as string[] | null) ?? [],
          quietHoursStart: (prefRes.data.quiet_hours_start as string | null) ?? null,
          quietHoursEnd: (prefRes.data.quiet_hours_end as string | null) ?? null,
        }
      : null,
    devices: (subRes.data ?? []).map((s) => ({
      endpoint: String(s.endpoint),
      label: (s.device_label as string | null) ?? null,
    })),
  };
}
