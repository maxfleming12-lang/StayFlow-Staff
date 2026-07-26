import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/session";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";

export const metadata: Metadata = {
  title: "Reports · StayFlow Staff",
};

/**
 * Reports.
 *
 * Restricted to manager and above. The check runs server-side, so
 * removing the navigation entry is not what protects it.
 */
export default async function ReportsPage() {
  await requireRole("manager");

  return (
    <ModulePlaceholder
      title="Reports"
      icon="chart"
      summary="Labour, attendance and completion reporting across your properties."
      upcoming={[
        "Rostered against worked hours",
        "Labour hours by property and by team",
        "Attendance variance, late starts and missed clock-outs",
        "Leave totals and unfilled shifts",
        "CSV export and a print-friendly view",
      ]}
    />
  );
}
