import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names, resolving conflicts in favour of the last
 * value. Lets a component expose a `className` prop that can genuinely
 * override its defaults rather than fighting them in the cascade.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
