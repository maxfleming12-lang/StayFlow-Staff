import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { ROLE_LABEL, isOrganisationAdmin } from "@/lib/auth/roles";
import { formatDateTime } from "@/lib/format";
import { BUILD_INFO } from "@/lib/build-info";
import { siteUrl } from "@/lib/supabase/env";
import { getMyCalendarToken } from "@/lib/calendar/actions";
import { CalendarSubscription } from "@/components/calendar/calendar-subscription";
import { NotificationSettings } from "@/components/notifications/notification-settings";
import { getMyNotificationPreferences } from "@/lib/notifications/actions";

export const metadata: Metadata = {
  title: "Settings · StayFlow Staff",
};

/** One label/value row. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0 dark:border-slate-800">
      <dt className="text-sm text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-right text-sm font-medium text-slate-900 dark:text-slate-100">
        {value}
      </dd>
    </div>
  );
}

/**
 * Settings and account information.
 *
 * System information (version, build date, commit) is shown to
 * administrators and owners. These values are generated during the build,
 * never typed by hand — see next.config.ts.
 */
export default async function SettingsPage() {
  const user = await requireUser();
  const calendarToken = await getMyCalendarToken();
  const { preferences, devices } = await getMyNotificationPreferences();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
        Settings
      </h1>

      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Your account
        </h2>
        <dl className="mt-3">
          <Row label="Name" value={`${user.legalFirstName} ${user.legalLastName}`.trim() || "—"} />
          <Row label="Preferred name" value={user.preferredName || "—"} />
          <Row label="Email" value={user.email} />
          <Row label="Role" value={ROLE_LABEL[user.role]} />
          <Row
            label="Properties"
            value={
              user.propertyIds.length > 0
                ? `${user.propertyIds.length} assigned`
                : "All properties"
            }
          />
        </dl>
      </section>

      <NotificationSettings
        vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
        devices={devices}
        mutedCategories={preferences?.mutedCategories ?? []}
        quietHoursStart={preferences?.quietHoursStart ?? null}
        quietHoursEnd={preferences?.quietHoursEnd ?? null}
      />

      <CalendarSubscription token={calendarToken} siteUrl={siteUrl()} />

      {isOrganisationAdmin(user.role) && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            System information
          </h2>
          <dl className="mt-3">
            <Row label="Version" value={BUILD_INFO.version} />
            <Row label="Built" value={formatDateTime(BUILD_INFO.buildDate)} />
            <Row label="Commit" value={BUILD_INFO.commitSha} />
            <Row label="Environment" value={BUILD_INFO.environment} />
          </dl>
        </section>
      )}
    </div>
  );
}
