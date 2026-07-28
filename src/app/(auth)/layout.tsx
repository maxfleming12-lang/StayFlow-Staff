import type { ReactNode } from "react";
import { BrandMark } from "@/components/layout/brand-mark";

/**
 * Shell for unauthenticated screens.
 *
 * Centres a single card, and keeps it above the fold on a phone so the
 * keyboard does not push the submit button out of reach.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <main className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size="lg" />
          <h1 className="mt-4 text-xl font-semibold text-slate-900 dark:text-slate-50">
            StayFlow Staff
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Rosters, timesheets and team updates
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {children}
        </div>
      </main>
    </div>
  );
}
