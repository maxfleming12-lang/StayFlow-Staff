import "server-only";
import webpush from "web-push";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  DEFAULT_PREFERENCES,
  shouldPush,
  type NotificationPreferences,
} from "./policy";
import type { Database } from "@/types/database";

type Category = Database["public"]["Enums"]["notification_category"];

/**
 * Creating and delivering a notification.
 *
 * One place that knows how to notify somebody, because the alternative —
 * every action inserting its own row and separately remembering to push —
 * guarantees that some path eventually records a notification nobody ever
 * receives. Actions call `notify()` and stop thinking about it.
 *
 * The row is ALWAYS written. Preferences decide only whether a device is
 * interrupted; a muted category still appears in the app, because muting a
 * category should quieten the phone, not hide information.
 */

export interface NotifyInput {
  organisationId: string;
  userIds: string[];
  category: Category;
  title: string;
  /**
   * Shown on a lock screen in a public area, so it must carry no private
   * detail — no times, names, pay or medical reasons. "Open StayFlow to
   * review it" is the pattern.
   */
  body: string;
  deepLink?: string;
  propertyId?: string | null;
}

export interface NotifyResult {
  recorded: number;
  pushed: number;
  /** Subscriptions removed because the browser said they are dead. */
  pruned: number;
  error?: string;
}

let vapidConfigured: boolean | null = null;

/** Configure web-push once, and only when keys are actually present. */
function configureVapid(): boolean {
  if (vapidConfigured !== null) return vapidConfigured;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:support@stayflow.local";

  if (!publicKey || !privateKey) {
    vapidConfigured = false;
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

/** Preferences for several people at once, defaulted where absent. */
async function preferencesFor(
  admin: ReturnType<typeof createServiceRoleClient>,
  userIds: string[],
): Promise<Map<string, NotificationPreferences>> {
  const { data } = await admin
    .from("notification_preferences")
    .select("user_id, push_enabled, muted_categories, quiet_hours_start, quiet_hours_end")
    .in("user_id", userIds);

  const map = new Map<string, NotificationPreferences>();
  for (const row of data ?? []) {
    map.set(String(row.user_id), {
      // A row exists, so the person has been through settings at least once.
      pushEnabled: row.push_enabled ?? true,
      mutedCategories: (row.muted_categories as string[] | null) ?? [],
      quietHoursStart: (row.quiet_hours_start as string | null) ?? null,
      quietHoursEnd: (row.quiet_hours_end as string | null) ?? null,
    });
  }
  return map;
}

/**
 * Record a notification for each user and push it where appropriate.
 *
 * Never throws. A failed push must not roll back the action that triggered
 * it — a published roster is still published even if a phone is
 * unreachable — so problems are reported in the result instead.
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const userIds = [...new Set(input.userIds)].filter(Boolean);
  if (userIds.length === 0) {
    return { recorded: 0, pushed: 0, pruned: 0 };
  }

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch {
    return {
      recorded: 0,
      pushed: 0,
      pruned: 0,
      error: "Server is not configured to send notifications.",
    };
  }

  // 1. Record. This is the part that must not be skipped.
  const { error: insertError } = await admin.from("notifications").insert(
    userIds.map((userId) => ({
      organisation_id: input.organisationId,
      property_id: input.propertyId ?? null,
      user_id: userId,
      category: input.category,
      title: input.title,
      body: input.body,
      deep_link: input.deepLink ?? null,
    })),
  );

  if (insertError) {
    return { recorded: 0, pushed: 0, pruned: 0, error: insertError.message };
  }

  // 2. Push, where the person's settings allow it.
  if (!configureVapid()) {
    // Not an error worth failing the caller over: in development there may
    // simply be no keys. The notification is recorded and visible in-app.
    return { recorded: userIds.length, pushed: 0, pruned: 0 };
  }

  const prefs = await preferencesFor(admin, userIds);
  const eligible = userIds.filter(
    (id) => shouldPush({
      category: input.category,
      preferences: prefs.get(id) ?? { ...DEFAULT_PREFERENCES, pushEnabled: true },
    }).push,
  );

  if (eligible.length === 0) {
    return { recorded: userIds.length, pushed: 0, pruned: 0 };
  }

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth_key, failure_count")
    .in("user_id", eligible);

  if (!subs || subs.length === 0) {
    return { recorded: userIds.length, pushed: 0, pruned: 0 };
  }

  const payload = JSON.stringify({
    title: input.title,
    body: input.body,
    url: input.deepLink ?? "/",
    category: input.category,
  });

  let pushed = 0;
  const dead: string[] = [];
  const failing: { id: string; failureCount: number }[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: String(sub.endpoint),
            keys: { p256dh: String(sub.p256dh), auth: String(sub.auth_key) },
          },
          payload,
        );
        pushed += 1;
        // Clear any accumulated failures: the endpoint is alive again.
        if ((sub.failure_count ?? 0) > 0) {
          await admin
            .from("push_subscriptions")
            .update({ failure_count: 0, last_used_at: new Date().toISOString() })
            .eq("id", sub.id);
        }
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;

        // 404/410 mean the browser has discarded the subscription outright.
        if (status === 404 || status === 410) {
          dead.push(String(sub.id));
          return;
        }

        // Anything else — a transient outage, or malformed keys that throw
        // during encryption before any request is made — is counted. Without
        // this, a permanently broken subscription is retried on every
        // notification forever, and nothing ever notices.
        failing.push({
          id: String(sub.id),
          failureCount: (sub.failure_count ?? 0) + 1,
        });
      }
    }),
  );

  // Give up on a subscription that has failed repeatedly. The person simply
  // re-enables notifications on that device, which creates a fresh row.
  const MAX_FAILURES = 10;
  for (const item of failing) {
    if (item.failureCount >= MAX_FAILURES) {
      dead.push(item.id);
    } else {
      await admin
        .from("push_subscriptions")
        .update({ failure_count: item.failureCount })
        .eq("id", item.id);
    }
  }

  if (dead.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", dead);
  }

  return { recorded: userIds.length, pushed, pruned: dead.length };
}
