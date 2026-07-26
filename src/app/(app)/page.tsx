import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { ROLE_DESCRIPTION, ROLE_LABEL, canManageRosters } from "@/lib/auth/roles";
import { formatLongDate } from "@/lib/format";
import { navItemsFor } from "@/lib/navigation";
import { NavIcon } from "@/components/layout/nav-icon";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Dashboard · StayFlow Staff",
};

/**
 * Landing screen.
 *
 * The full role-specific dashboards — attendance state, next shift, tasks
 * due, pending acknowledgements — arrive with the operational modules. For
 * now this confirms who is signed in and routes them onward, which is what
 * the foundation milestone needs to demonstrate.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ passwordUpdated?: string }>;
}) {
  const user = await requireUser();
  const { passwordUpdated } = await searchParams;
  const destinations = navItemsFor(user.role).filter((i) => i.href !== "/");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {passwordUpdated && (
        <Alert tone="success" title="Password updated">
          Your new password is now in use.
        </Alert>
      )}

      <div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {formatLongDate(new Date())}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">
          Good day, {user.displayName || "there"}
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          You are signed in as {ROLE_LABEL[user.role]}.{" "}
          {ROLE_DESCRIPTION[user.role]}
        </p>
      </div>

      <Alert tone="info" title="Foundation build">
        Authentication, roles and the application shell are in place. Rostering,
        the time clock, timesheets and notifications are being built next — the
        sections below are ready for them.
      </Alert>

      <section aria-labelledby="destinations-heading">
        <h2
          id="destinations-heading"
          className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
        >
          Your sections
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {destinations.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-teal-300 hover:bg-teal-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-800 dark:hover:bg-teal-950/30"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400">
                  <NavIcon name={item.icon} className="h-5 w-5" />
                </span>
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {item.label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {canManageRosters(user.role) && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Labour hours and costs shown anywhere in StayFlow are estimates for
          planning only. They are not award-interpreted payroll figures.
        </p>
      )}
    </div>
  );
}
