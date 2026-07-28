import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";

export const metadata: Metadata = {
  title: "Announcements · StayFlow Staff",
};

/**
 * Announcements.
 */
export default async function AnnouncementsPage() {
  await requireUser();

  return (
    <ModulePlaceholder
      title="Announcements"
      icon="megaphone"
      summary="Notices from management, including urgent operational updates."
      upcoming={[
        "General, policy, shift, safety and urgent notices",
        "Attachments and expiry dates",
        "Required acknowledgement with read receipts",
        "Targeting by person, team or property",
      ]}
    />
  );
}
