import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { getLeaveForReview, parseLeaveStatus } from "@/lib/leave/queries";
import { LeaveCard } from "@/components/leave/leave-card";
import { LeaveDecision } from "@/components/leave/leave-decision";

export const metadata: Metadata = {
  title: "Leave requests · StayFlow Staff",
};

export const dynamic = "force-dynamic";

const FILTERS = [
  { value: "pending", label: "Awaiting review" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
  { value: "", label: "All" },
] as const;

/**
 * Management leave review.
 *
 * Restricted to managers and above by `requireRole`, and independently by
 * RLS — which also scopes the list to staff at properties assigned to the
 * caller, so a Coastal-only manager never sees a Holiday Lodge request.
 */
export default async function ManageLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireRole("manager");
  const { status } = await searchParams;

  // `status` comes from the URL, so it is untrusted: an unrecognised value
  // falls back to showing everything rather than reaching the database.
  const active = status === undefined ? "pending" : status;
  const requests = await getLeaveForReview(parseLeaveStatus(active));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Leave requests
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Requests from staff at your properties.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        {FILTERS.map((filter) => {
          const isActive = active === filter.value;
          return (
            <Link
              key={filter.value || "all"}
              href={
                filter.value
                  ? `/manage/leave?status=${filter.value}`
                  : "/manage/leave?status="
              }
              aria-current={isActive ? "page" : undefined}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                isActive
                  ? "border-teal-600 bg-teal-50 font-medium text-teal-800 dark:bg-teal-950 dark:text-teal-300"
                  : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400"
              }`}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {requests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
          <CheckCircle2
            className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
            strokeWidth={1.5}
          />
          <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
            {active === "pending"
              ? "Nothing awaiting review"
              : "No requests to show"}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {active === "pending"
              ? "New leave requests appear here as staff submit them."
              : "Try a different filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((request) => (
            <LeaveCard
              key={request.id}
              request={request}
              showStaffName
              actions={
                request.status === "pending" ? (
                  <LeaveDecision
                    requestId={request.id}
                    hasConflicts={request.conflictingShifts.length > 0}
                  />
                ) : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
