import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";

export const metadata: Metadata = {
  title: "Documents · StayFlow Staff",
};

/**
 * Documents.
 */
export default async function DocumentsPage() {
  await requireUser();

  return (
    <ModulePlaceholder
      title="Documents"
      icon="folder"
      summary="Policies, procedures and forms you are permitted to read."
      upcoming={[
        "Policies, procedures, emergency, training and forms folders",
        "Access by role, team or property",
        "Documents requiring your acknowledgement",
        "Version history",
        "Time-limited access links rather than public URLs",
      ]}
    />
  );
}
