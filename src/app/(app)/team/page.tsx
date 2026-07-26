import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/session";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";

export const metadata: Metadata = {
  title: "Team · StayFlow Staff",
};

/**
 * Team.
 *
 * Restricted to supervisor and above. The check runs server-side, so
 * removing the navigation entry is not what protects it.
 */
export default async function TeamPage() {
  await requireRole("supervisor");

  return (
    <ModulePlaceholder
      title="Team"
      icon="people"
      summary="Your assigned teams and their attendance."
      upcoming={[
        "Who is clocked in, on break or running late",
        "Team attendance monitoring",
        "Handover notes",
        "Assigning and verifying tasks",
        "Confidential employment detail stays restricted to management",
      ]}
    />
  );
}
