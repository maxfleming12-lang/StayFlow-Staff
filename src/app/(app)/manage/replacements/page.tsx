import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { getReplacementsForReview } from "@/lib/replacements/queries";
import { REPLACEMENT_STATUS_LABEL } from "@/lib/replacements/eligibility";
import { formatLongDate, formatTime } from "@/lib/format";
import { ReplacementDecision } from "@/components/replacements/replacement-decision";

export const metadata: Metadata = {
  title: "Shift cover · StayFlow Staff",
};

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  requested: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  offered: "bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-300",
  claimed:
    "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

/**
 * Management review of replacement requests.
 *
 * RLS scopes this to the caller's properties. Only in-flight requests are
 * listed — a settled one needs nothing from a manager.
 */
export default async function ManageReplacementsPage() {
  await requireRole("manager");
  const requests = await getReplacementsForReview();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Shift cover
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Staff asking to be replaced on a shift.
        </p>
      </div>

      {requests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
          <CheckCircle2
            className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
            strokeWidth={1.5}
          />
          <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
            Nothing needs cover
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Requests appear here as staff submit them.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((request) => (
            <article
              key={request.id}
              className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 pl-5 dark:border-slate-800 dark:bg-slate-900"
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1.5"
                style={{
                  backgroundColor: request.shift?.propertyColour ?? "#0f766e",
                }}
              />

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {request.requesterName}
                  </p>
                  {request.shift && (
                    <>
                      <p className="text-base font-medium text-slate-900 dark:text-slate-100">
                        {formatLongDate(request.shift.startsAt)}
                      </p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {formatTime(request.shift.startsAt)} –{" "}
                        {formatTime(request.shift.endsAt)} ·{" "}
                        {request.shift.propertyName}
                      </p>
                    </>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                    STATUS_STYLES[request.status] ?? STATUS_STYLES.requested
                  }`}
                >
                  {REPLACEMENT_STATUS_LABEL[request.status] ?? request.status}
                </span>
              </div>

              {request.reason && (
                <p className="mt-3 whitespace-pre-line text-sm text-slate-600 dark:text-slate-400">
                  {request.reason}
                </p>
              )}

              <div className="mt-4">
                <ReplacementDecision
                  requestId={request.id}
                  status={request.status}
                  claimantName={request.replacementName}
                />
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        A request never removes anyone from the roster. The original staff
        member stays rostered until you approve a replacement.
      </p>
    </div>
  );
}
