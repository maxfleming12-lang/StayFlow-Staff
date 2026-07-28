import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Accessible form label. */
export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "block text-sm font-medium text-slate-700 dark:text-slate-300",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Text input.
 *
 * `text-base` (16px) is deliberate: iOS Safari zooms the viewport when a
 * focused input renders below 16px, which is disorienting on a phone.
 */
export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900",
        "placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
        "aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-500/30",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A labelled field with optional hint and error text.
 *
 * The error is wired to the input through `aria-describedby` and announced
 * via `role="alert"`, so a screen-reader user hears the failure rather than
 * only seeing red text.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && (
        <p id={hintId} className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
