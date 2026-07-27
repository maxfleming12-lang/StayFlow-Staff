import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getMyAvailability } from "@/lib/availability/queries";
import { isExpired } from "@/lib/availability/rules";
import { AvailabilityCard } from "@/components/availability/availability-card";
import { AvailabilityForm } from "@/components/availability/availability-form";

export const metadata: Metadata = {
  title: "Availability · StayFlow Staff",
};

export const dynamic = "force-dynamic";

/**
 * Staff availability.
 *
 * Shows only the signed-in person's rules — enforced by Row Level Security,
 * not by a filter written here.
 */
export default async function AvailabilityPage() {
  await requireUser();
  const rules = await getMyAvailability();

  const current = rules.filter((r) => !isExpired(r));
  const past = rules.filter((r) => isExpired(r));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Availability
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Tell your manager when you can and cannot work.
        </p>
      </div>

      <AvailabilityForm />

      {rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
          <CalendarClock
            className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
            strokeWidth={1.5}
          />
          <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
            No availability set
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Until you add something, your manager will assume you can work any
            rostered shift.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="current-availability">
            <h2
              id="current-availability"
              className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
            >
              Current
            </h2>
            <div className="space-y-3">
              {current.map((record) => (
                <AvailabilityCard key={record.id} record={record} />
              ))}
            </div>
          </section>

          {past.length > 0 && (
            <section aria-labelledby="past-availability">
              <h2
                id="past-availability"
                className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
              >
                Past dates
              </h2>
              <div className="space-y-3">
                {past.map((record) => (
                  <AvailabilityCard key={record.id} record={record} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Availability is a guide for your manager, not a guarantee. A shift can
        still be rostered over it if the motel needs cover — you will see the
        shift on your roster and can decline it.
      </p>
    </div>
  );
}
