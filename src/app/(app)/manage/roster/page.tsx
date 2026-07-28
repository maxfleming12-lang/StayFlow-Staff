import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { canViewConfidentialEmployment } from "@/lib/auth/roles";
import { getRosterWeek } from "@/lib/roster/manager-queries";
import {
  formatWeekLabel,
  shiftWeek,
  weekDates,
  weekStart,
} from "@/lib/roster/week";
import { formatCurrency, formatHours } from "@/lib/format";
import { hospitalityCasualEstimatedCost } from "@/lib/roster/hours";
import { RosterGrid } from "@/components/roster/roster-grid";
import { PublishRoster } from "@/components/roster/publish-roster";
import { ShiftForm } from "@/components/roster/shift-form";
import { WeekTools } from "@/components/roster/week-tools";
import { getTemplates } from "@/lib/roster/template-actions";

export const metadata: Metadata = {
  title: "Roster · StayFlow Staff",
};

export const dynamic = "force-dynamic";

/**
 * Management weekly roster.
 *
 * Restricted to managers and above by `requireRole`, and independently by
 * RLS — a supervisor reaching this URL directly gets the denied screen, and
 * would see no rows even if they did not.
 */
export default async function ManageRosterPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; property?: string }>;
}) {
  const user = await requireRole("manager");
  const { week, property } = await searchParams;

  const current = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : weekStart();
  const roster = await getRosterWeek(current, property);
  const templates = await getTemplates(property);
  const days = weekDates(current);

  const showCost = canViewConfidentialEmployment(user.role);
  const rateFor = new Map(roster.staff.map((s) => [s.id, s.hourlyRate]));

  const totalHours = roster.shifts.reduce((sum, s) => sum + s.paidHours, 0);

  // Cost is only meaningful when every rostered person has a known rate;
  // otherwise it silently understates. Track that rather than hide it.
  let knownCost = 0;
  let missingRates = 0;
  for (const shift of roster.shifts) {
    const rate = shift.userId ? rateFor.get(shift.userId) : null;
    const cost = hospitalityCasualEstimatedCost(shift, rate ?? null);
    if (cost == null) missingRates += 1;
    else knownCost += cost;
  }

  const hrefFor = (w: string) =>
    `/manage/roster?week=${w}${property ? `&property=${property}` : ""}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
            Roster
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {formatWeekLabel(current)}
          </p>
        </div>

        <nav className="flex items-center gap-1" aria-label="Roster week">
          <Link
            href={hrefFor(shiftWeek(current, -1))}
            aria-label="Previous week"
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <Link
            href={hrefFor(weekStart())}
            className="flex h-11 items-center rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            This week
          </Link>
          <Link
            href={hrefFor(shiftWeek(current, 1))}
            aria-label="Next week"
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </Link>
        </nav>
      </div>

      {/* Property filter */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/manage/roster?week=${current}`}
          className={`rounded-full border px-3 py-1.5 text-sm ${
            !property
              ? "border-teal-600 bg-teal-50 font-medium text-teal-800 dark:bg-teal-950 dark:text-teal-300"
              : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400"
          }`}
        >
          Both properties
        </Link>
        {roster.properties.map((p) => (
          <Link
            key={p.id}
            href={`/manage/roster?week=${current}&property=${p.id}`}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
              property === p.id
                ? "border-teal-600 bg-teal-50 font-medium text-teal-800 dark:bg-teal-950 dark:text-teal-300"
                : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400"
            }`}
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: p.colour ?? "#0f766e" }}
            />
            {p.name}
          </Link>
        ))}
      </div>

      {/* Week totals */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <dt className="text-xs text-slate-500 dark:text-slate-400">Shifts</dt>
          <dd className="mt-0.5 text-lg font-semibold text-slate-900 dark:text-slate-50">
            {roster.shifts.length}
          </dd>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <dt className="text-xs text-slate-500 dark:text-slate-400">
            Labour hours
          </dt>
          <dd className="mt-0.5 text-lg font-semibold text-slate-900 dark:text-slate-50">
            {formatHours(totalHours)}
          </dd>
        </div>
        {showCost && (
          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <dt className="text-xs text-slate-500 dark:text-slate-400">
              Estimated cost
            </dt>
            <dd className="mt-0.5 text-lg font-semibold text-slate-900 dark:text-slate-50">
              {formatCurrency(knownCost)}
            </dd>
            {missingRates > 0 && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                Excludes {missingRates} shift{missingRates === 1 ? "" : "s"} with
                no pay rate
              </p>
            )}
          </div>
        )}
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <dt className="text-xs text-slate-500 dark:text-slate-400">
            Unfilled
          </dt>
          <dd className="mt-0.5 text-lg font-semibold text-slate-900 dark:text-slate-50">
            {roster.shifts.filter((s) => !s.userId).length}
          </dd>
        </div>
      </dl>

      <ShiftForm
        properties={roster.properties}
        staff={roster.staff}
        defaultDate={days[0]}
      />

      <RosterGrid
        days={days}
        staff={roster.staff}
        shifts={roster.shifts}
        properties={roster.properties}
        weekStartDate={current}
      />

      <WeekTools
        weekStartDate={current}
        properties={roster.properties}
        templates={templates}
        propertyId={property}
        shiftCount={roster.shifts.length}
      />

      <PublishRoster
        weekStartDate={current}
        properties={roster.properties}
        periods={roster.periods}
        draftCount={roster.shifts.filter((s) => s.status === "draft").length}
      />

      {showCost && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Labour cost is an estimate using the configured casual base rates
          with Hospitality Award Saturday and Sunday multipliers. It excludes
          other penalties, loadings, overtime and allowances, and is not an
          award interpretation.
        </p>
      )}
    </div>
  );
}
