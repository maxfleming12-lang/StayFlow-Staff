import type { Metadata } from "next";
import { getKioskSession, getKioskStaff } from "@/lib/kiosk/session";
import { KioskClock } from "@/components/kiosk/kiosk-clock";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Clock on · StayFlow Staff",
  // A shared tablet screen should never be indexed or previewed.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The kiosk screen.
 *
 * Deliberately outside the (app) layout: there is no signed-in user, no
 * navigation, and nothing to reach from here except clocking on. A shared
 * tablet must not be a doorway into the rest of the application.
 */
export default async function KioskPage({
  searchParams,
}: {
  searchParams: Promise<{ invalid?: string }>;
}) {
  const { invalid } = await searchParams;
  const session = await getKioskSession();

  if (!session) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md items-center p-6">
        <Alert tone="error" title="This device is not set up">
          {invalid
            ? "That kiosk link is not valid, or it has expired or been revoked."
            : "Ask a manager to authorise this tablet from Manage → Kiosk devices."}
        </Alert>
      </main>
    );
  }

  const staff = await getKioskStaff(session);

  return (
    <main className="mx-auto min-h-dvh max-w-md p-5">
      <header className="py-4 text-center">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          StayFlow
        </h1>
      </header>

      <KioskClock staff={staff} propertyName={session.propertyName} />

      <p className="mt-8 text-center text-xs text-slate-500 dark:text-slate-400">
        Times are recorded by StayFlow&rsquo;s server. Your PIN clocks only
        you on and off — it does not sign you in.
      </p>
    </main>
  );
}
