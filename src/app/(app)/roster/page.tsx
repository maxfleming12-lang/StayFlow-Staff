import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";

export const metadata: Metadata = {
  title: "My roster · StayFlow Staff",
};

/**
 * My roster.
 */
export default async function RosterPage() {
  await requireUser();

  return (
    <ModulePlaceholder
      title="My roster"
      icon="calendar"
      summary="Your published shifts — today, this week and what is coming up."
      upcoming={[
        "Today, this week and upcoming shift lists",
        "Shift date, times, property, team and break detail",
        "Manager notes and estimated hours",
        "Accept or decline shifts that require acknowledgement",
        "Private calendar subscription for Apple Calendar, Google Calendar or Outlook",
      ]}
    />
  );
}
