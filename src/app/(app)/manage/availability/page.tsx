import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import {
  getAvailabilityForReview,
  parseAvailabilityStatus,
} from "@/lib/availability/queries";
import { AvailabilityCard } from "@/components/availability/availability-card";
import { AvailabilityDecision } from "@/components/availability/availability-decision";

export const metadata: Metadata = {
  title: "Availability · StayFlow Staff",
};

export const dynamic = "force-dynamic";

const FILTERS = [
  { value: "pending", label: "Awaiting review" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
  { value: "", label: "All" },
] as const;

/**
 * Management availability review.
 *
 * RLS scopes the list to staff at the caller's properties, so a Coastal-only
 * manager never sees a Holiday Lodge submission.
 */
export default async function ManageAvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireRole("manager");
  const { status } = await searchParams;

  // Untrusted URL input: anything unrecognised means "no filter".
  const active = status === undefined ? "pending" : status;
  const records = await getAvailabilityForReview(
    parseAvailabilityStatus(active),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Availability
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Submissions from staff at your properties.
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
                  ? `/manage/availability?status=${filter.value}`
                  : "/manage/availability?status="
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

      {active === "pending" && records.length > 0 && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          Roster warnings only use <strong>approved</strong> availability. While
          a submission sits here, creating a clashing shift warns nobody.
        </p>
      )}

      {records.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
          <CheckCircle2
            className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
            strokeWidth={1.5}
          />
          <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
            {active === "pending"
              ? "Nothing awaiting review"
              : "No submissions to show"}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {active === "pending"
              ? "New availability appears here as staff submit it."
              : "Try a different filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((record) => (
            <AvailabilityCard
              key={record.id}
              record={record}
              showStaffName
              actions={
                record.status === "pending" ? (
                  <AvailabilityDecision recordId={record.id} />
                ) : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
