import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";

export const metadata: Metadata = {
  title: "Tasks · StayFlow Staff",
};

/**
 * Tasks.
 */
export default async function TasksPage() {
  await requireUser();

  return (
    <ModulePlaceholder
      title="Tasks"
      icon="checklist"
      summary="Operational jobs assigned to you or your team."
      upcoming={[
        "Housekeeping, reception, maintenance, grounds and safety categories",
        "Room or location, priority and due time",
        "Checklists, before and completion photos",
        "Comments and manager verification",
        "Recurring task schedules",
      ]}
    />
  );
}
