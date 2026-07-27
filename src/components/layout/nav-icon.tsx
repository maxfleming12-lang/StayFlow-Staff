import {
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  Clock,
  FolderClosed,
  Home,
  Megaphone,
  Settings,
  Timer,
  Users,
} from "lucide-react";
import type { NavIcon as NavIconName } from "@/lib/navigation";

/** Map from the navigation model's icon names to Lucide components. */
const ICONS = {
  home: Home,
  calendar: CalendarDays,
  clock: Clock,
  timesheet: Timer,
  people: Users,
  megaphone: Megaphone,
  checklist: ClipboardCheck,
  folder: FolderClosed,
  chart: BarChart3,
  settings: Settings,
  swap: ArrowLeftRight,
} as const;

/**
 * Render a navigation icon.
 *
 * Always decorative: the adjacent text label is the accessible name, so the
 * icon is hidden from assistive technology to avoid a duplicate reading.
 */
export function NavIcon({
  name,
  className,
}: {
  name: NavIconName;
  className?: string;
}) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden="true" strokeWidth={1.75} />;
}
