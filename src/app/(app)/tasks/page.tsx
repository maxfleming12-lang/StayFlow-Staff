import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE, localDateTimeValue } from "@/lib/format";
import { getTasks } from "@/lib/tasks/queries";
import { OPEN_STATUSES } from "@/lib/tasks/status";
import { getTeam } from "@/lib/team/queries";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskForm } from "@/components/tasks/task-form";

export const metadata: Metadata = { title: "Tasks · StayFlow Staff" };
export const dynamic = "force-dynamic";

/**
 * Operational jobs.
 *
 * RLS decides what is listed: management see their properties' jobs, and
 * everyone else sees what is assigned to them or to their team. So this page
 * is the same component for both, with the create form and the check-off
 * button appearing by role.
 */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const user = await requireUser();
  const { show } = await searchParams;
  const includeFinished = show === "all";

  const canCreate = atLeast(user.role, "supervisor");
  const canVerify = atLeast(user.role, "supervisor");

  const [tasks, propertyRes, team] = await Promise.all([
    getTasks({ includeFinished }),
    createClient().then((s) =>
      s
        .from("properties")
        .select("id, name")
        .eq("is_active", true)
        .is("archived_at", null)
        .order("name"),
    ),
    canCreate ? getTeam() : Promise.resolve([]),
  ]);

  if (propertyRes.error) {
    throw new Error(`Could not load properties: ${propertyRes.error.message}`);
  }

  const properties = (propertyRes.data ?? []).map((p) => ({
    id: String(p.id),
    name: String(p.name),
  }));

  // Default a new job to later today, at the property's clock.
  const now = new Date();
  const defaultDue = localDateTimeValue(
    new Date(now.getTime() + 4 * 3_600_000),
    DEFAULT_TIMEZONE,
  );

  const open = tasks.filter((t) => OPEN_STATUSES.includes(t.status));

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
            Tasks
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {includeFinished
              ? "Everything, including finished jobs."
              : `${open.length} job${open.length === 1 ? "" : "s"} to do.`}
          </p>
        </div>
        <Link
          href={includeFinished ? "/tasks" : "/tasks?show=all"}
          className="text-sm font-medium text-teal-700 underline dark:text-teal-400"
        >
          {includeFinished ? "Show only what is left" : "Show finished too"}
        </Link>
      </div>

      {canCreate && (
        <TaskForm
          properties={properties}
          staff={team
            .filter((member) => member.isActive)
            .map((member) => ({ id: member.id, displayName: member.displayName }))}
          defaultDueDate={defaultDue}
        />
      )}

      {tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
          <ClipboardList
            className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
            strokeWidth={1.5}
          />
          <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
            {includeFinished ? "No jobs yet" : "Nothing to do"}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {canCreate
              ? "Create a job above and assign it to somebody."
              : "Jobs assigned to you or your team will appear here."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} canVerify={canVerify} />
          ))}
        </div>
      )}
    </div>
  );
}
