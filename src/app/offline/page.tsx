import type { Metadata } from "next";
import { BrandMark } from "@/components/layout/brand-mark";

export const metadata: Metadata = {
  title: "Offline · StayFlow Staff",
};

/**
 * Offline fallback, precached by the service worker.
 *
 * Must not depend on any data fetch — it is rendered precisely when the
 * network is unavailable.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 text-center dark:bg-slate-950">
      <main className="w-full max-w-sm">
        <BrandMark size="lg" className="mx-auto" />
        <h1 className="mt-6 text-xl font-semibold text-slate-900 dark:text-slate-50">
          You are offline
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          StayFlow Staff needs a connection to load this screen. Your phone will
          reconnect automatically when reception returns.
        </p>
        <p className="mt-6 rounded-lg bg-white p-3 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
          Clock actions made while offline are queued on your device and sent as
          soon as you are back online.
        </p>
      </main>
    </div>
  );
}
