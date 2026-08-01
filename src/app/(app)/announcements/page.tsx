import type { Metadata } from "next";
import { Megaphone } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getAnnouncements } from "@/lib/announcements/queries";
import { isLive } from "@/lib/announcements/status";
import { AnnouncementCard } from "@/components/announcements/announcement-card";
import { AnnouncementForm } from "@/components/announcements/announcement-form";

export const metadata: Metadata = { title: "Announcements · StayFlow Staff" };
export const dynamic = "force-dynamic";

/**
 * Notices from management.
 *
 * RLS does the targeting: `announcements_select_targeted` returns a
 * published, unexpired notice to somebody it was aimed at, and a manager's
 * policy returns everything. So this is one page for both, with the compose
 * form and the withdraw button appearing by role.
 */
export default async function AnnouncementsPage() {
  const user = await requireUser();
  const canManage = atLeast(user.role, "manager");

  const supabase = await createClient();
  const [announcements, propertyRes] = await Promise.all([
    getAnnouncements(user.id, { forManagement: canManage }),
    supabase
      .from("properties")
      .select("id, name")
      .eq("is_active", true)
      .is("archived_at", null)
      .order("name"),
  ]);

  if (propertyRes.error) {
    throw new Error(`Could not load properties: ${propertyRes.error.message}`);
  }

  const properties = (propertyRes.data ?? []).map((p) => ({
    id: String(p.id),
    name: String(p.name),
  }));
  const propertyNames = new Map(properties.map((p) => [p.id, p.name]));

  // Staff see live notices only. A manager sees everything, so the count
  // here describes what staff can actually read right now.
  const liveCount = announcements.filter((a) => isLive(a)).length;
  const awaitingAck = announcements.filter(
    (a) => a.requiresAck && isLive(a) && !a.myAck?.acknowledgedAt,
  ).length;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Announcements
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          {awaitingAck > 0
            ? `${awaitingAck} notice${awaitingAck === 1 ? "" : "s"} waiting for you to confirm.`
            : `${liveCount} current notice${liveCount === 1 ? "" : "s"}.`}
        </p>
      </div>

      {canManage && <AnnouncementForm properties={properties} />}

      {announcements.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
          <Megaphone
            className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
            strokeWidth={1.5}
          />
          <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
            Nothing posted
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {canManage
              ? "Post a notice above and it goes out straight away."
              : "Notices from your manager will appear here."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((announcement) => (
            <AnnouncementCard
              key={announcement.id}
              announcement={announcement}
              canManage={canManage}
              propertyNames={propertyNames}
            />
          ))}
        </div>
      )}
    </div>
  );
}
