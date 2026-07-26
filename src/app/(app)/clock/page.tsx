import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";

export const metadata: Metadata = {
  title: "Time clock · StayFlow Staff",
};

/**
 * Time clock.
 */
export default async function ClockPage() {
  await requireUser();

  return (
    <ModulePlaceholder
      title="Time clock"
      icon="clock"
      summary="Clock in, take your breaks and clock out."
      upcoming={[
        "Live date and time with your rostered shift",
        "Clock in, start break, end break and clock out",
        "Offline queueing when reception drops out",
        "Optional location capture, only with your permission",
        "Property kiosk mode with a personal PIN",
      ]}
    />
  );
}
