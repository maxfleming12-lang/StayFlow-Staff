import type { Metadata } from "next";
import { CalendarOff } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getMyLeave } from "@/lib/leave/queries";
import { LeaveCard } from "@/components/leave/leave-card";
import { LeaveForm } from "@/components/leave/leave-form";

export const metadata: Metadata = {
  title: "Leave · StayFlow Staff",
};

export const dynamic = "force-dynamic";

/**
 * Staff leave.
 *
 * Shows only the signed-in person's requests — enforced by Row Level
 * Security, not by a filter written here.
 */
export default async function LeavePage() {
  await requireUser();
  const requests = await getMyLeave();

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Leave
        </h1>
      </div>

      <LeaveForm />

      {requests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
          <CalendarOff
            className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
            strokeWidth={1.5}
          />
          <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
            No leave requests
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            When you request leave it appears here, along with your manager&rsquo;s
            decision.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {pending.length > 0 && (
            <section aria-labelledby="pending-leave">
              <h2
                id="pending-leave"
                className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
              >
                Awaiting review
              </h2>
              <div className="space-y-3">
                {pending.map((r) => (
                  <LeaveCard key={r.id} request={r} />
                ))}
              </div>
            </section>
          )}

          {decided.length > 0 && (
            <section aria-labelledby="past-leave">
              <h2
                id="past-leave"
                className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
              >
                Decided
              </h2>
              <div className="space-y-3">
                {decided.map((r) => (
                  <LeaveCard key={r.id} request={r} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Hours shown are an estimate for planning. They are not a leave balance
        or an entitlement calculation.
      </p>
    </div>
  );
}
