import { cn } from "@/lib/utils";

/**
 * StayFlow Staff brand mark.
 *
 * An original geometric mark: two offset bars suggesting a roster row and a
 * shift block. Drawn as inline SVG so it needs no network request and
 * renders identically offline.
 */
export function BrandMark({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dimension = size === "sm" ? 28 : size === "lg" ? 56 : 36;

  return (
    <svg
      width={dimension}
      height={dimension}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="StayFlow Staff"
      className={cn("shrink-0", className)}
    >
      <rect width="48" height="48" rx="12" className="fill-teal-700" />
      <rect x="11" y="14" width="20" height="6" rx="3" className="fill-white" />
      <rect
        x="11"
        y="24"
        width="26"
        height="6"
        rx="3"
        className="fill-white/70"
      />
      <rect x="11" y="34" width="14" height="4" rx="2" className="fill-white/40" />
    </svg>
  );
}
