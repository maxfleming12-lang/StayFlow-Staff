import type { NavIcon as NavIconName } from "@/lib/navigation";
import { NavIcon } from "./nav-icon";

/**
 * Placeholder for a module whose route, navigation entry and access rules
 * exist but whose functionality is scheduled for a later milestone.
 *
 * Being explicit about what is coming — rather than showing an empty page or
 * fake data — keeps the foundation build honest when it is demonstrated.
 */
export function ModulePlaceholder({
  title,
  icon,
  summary,
  upcoming,
}: {
  title: string;
  icon: NavIconName;
  summary: string;
  upcoming: string[];
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400">
          <NavIcon name={icon} className="h-6 w-6" />
        </span>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          {title}
        </h1>
      </div>

      <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">{summary}</p>

      <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Planned for this section
        </h2>
        <ul className="mt-3 space-y-2">
          {upcoming.map((item) => (
            <li
              key={item}
              className="flex gap-2.5 text-sm text-slate-600 dark:text-slate-400"
            >
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                •
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
