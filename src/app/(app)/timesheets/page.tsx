import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";

export const metadata: Metadata = {
  title: "My timesheets · StayFlow Staff",
};

/**
 * My timesheets.
 */
export default async function TimesheetsPage() {
  await requireUser();

  return (
    <ModulePlaceholder
      title="My timesheets"
      icon="timesheet"
      summary="The hours recorded against your shifts, and their approval status."
      upcoming={[
        "Rostered against actual start and finish times",
        "Break and total paid hours",
        "Request a correction or report missing time",
        "Acknowledge completed hours",
        "Approval status through to pay period export",
      ]}
    />
  );
}
