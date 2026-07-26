import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { BrandMark } from "@/components/layout/brand-mark";

export const metadata: Metadata = {
  title: "Access denied · StayFlow Staff",
};

/**
 * Shown when a signed-in user reaches something their role does not cover.
 *
 * Deliberately says nothing about what exists behind the restriction.
 */
export default function DeniedPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <main className="w-full max-w-sm text-center">
        <BrandMark size="lg" className="mx-auto" />
        <h1 className="mt-6 text-xl font-semibold text-slate-900 dark:text-slate-50">
          Access denied
        </h1>
        <div className="mt-4 text-left">
          <Alert tone="warning">
            Your role does not include access to that section. If you think this
            is a mistake, speak to your manager.
          </Alert>
        </div>
        <Link
          href="/"
          className="mt-6 inline-block text-sm font-medium text-teal-700 underline-offset-4 hover:underline dark:text-teal-400"
        >
          Back to dashboard
        </Link>
      </main>
    </div>
  );
}
