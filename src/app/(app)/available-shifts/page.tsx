import type { Metadata } from "next";
import { CalendarPlus, Clock, MapPin } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getAvailableShifts } from "@/lib/replacements/queries";
import { formatHours, formatLongDate, formatTime } from "@/lib/format";
import { ClaimShift } from "@/components/replacements/claim-shift";

export const metadata: Metadata = {
  title: "Available shifts · StayFlow Staff",
};

export const dynamic = "force-dynamic";

/**
 * Shifts a staff member could pick up.
 *
 * RLS limits this to published open shifts at properties they are permitted
 * to work at, so no property filter is written here.
 */
export default async function AvailableShiftsPage() {
  await requireUser();
  const shifts = await getAvailableShifts();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Available shifts
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Shifts needing cover at properties you can work at.
        </p>
      </div>

      {shifts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
          <CalendarPlus
            className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
            strokeWidth={1.5}
          />
          <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
            Nothing available right now
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            When a shift needs cover you will be notified and it will appear
            here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {shifts.map((shift) => (
            <article
              key={shift.id}
              className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 pl-5 dark:border-slate-800 dark:bg-slate-900"
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1.5"
                style={{ backgroundColor: shift.propertyColour ?? "#0f766e" }}
              />

              <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                {formatLongDate(shift.startsAt)}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
                {formatTime(shift.startsAt)} – {formatTime(shift.endsAt)}
              </p>

              <dl className="mt-3 space-y-1.5 text-sm text-slate-600 dark:text-slate-400">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <dt className="sr-only">Property</dt>
                  <dd>{shift.propertyName}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <dt className="sr-only">Hours</dt>
                  <dd>{formatHours(shift.paidHours)}</dd>
                </div>
                {shift.requiredRole && (
                  <div className="flex items-center gap-2">
                    <dt className="sr-only">Required</dt>
                    <dd className="rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
                      {shift.requiredRole}
                    </dd>
                  </div>
                )}
              </dl>

              {shift.notes && (
                <p className="mt-2 whitespace-pre-line text-sm text-slate-600 dark:text-slate-400">
                  {shift.notes}
                </p>
              )}

              <div className="mt-4">
                <ClaimShift
                  offerId={shift.myOffer?.id ?? null}
                  alreadyClaimed={shift.myOffer?.claimedByMe ?? false}
                />
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Asking for a shift does not roster you on it. Your manager confirms
        first, and you will get a notification either way.
      </p>
    </div>
  );
}
