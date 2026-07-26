import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type AlertTone = "info" | "success" | "warning" | "error";

const TONE_STYLES: Record<AlertTone, string> = {
  info: "border-slate-300 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
  success:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  warning:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  error:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
};

/**
 * Inline message block.
 *
 * Errors and warnings use `role="alert"` so assistive technology announces
 * them immediately; informational tones stay silent to avoid interrupting.
 */
export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const assertive = tone === "error" || tone === "warning";

  return (
    <div
      role={assertive ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-3.5 py-3 text-sm",
        TONE_STYLES[tone],
        className,
      )}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-1")}>{children}</div>}
    </div>
  );
}
