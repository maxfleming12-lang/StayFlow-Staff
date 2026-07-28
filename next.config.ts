import type { NextConfig } from "next";
import { execSync } from "node:child_process";

/**
 * Resolve the current git commit SHA at build time.
 *
 * Vercel exposes `VERCEL_GIT_COMMIT_SHA`; local builds fall back to `git`.
 * Returns "unknown" when neither is available so that a build never fails
 * merely because it is running outside a git checkout.
 */
function resolveCommitSha(): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel) return fromVercel.slice(0, 7);

  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

/**
 * Build metadata, generated at build time and exposed as public environment
 * variables. The version and build date are never hand-typed: the admin
 * "system information" screen reads these values.
 */
const buildInfo = {
  NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version ?? "0.0.0",
  NEXT_PUBLIC_BUILD_DATE: new Date().toISOString(),
  NEXT_PUBLIC_COMMIT_SHA: resolveCommitSha(),
  NEXT_PUBLIC_BUILD_ENV:
    process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: buildInfo,
  poweredByHeader: false,

  turbopack: {
    // A package.json in the parent directory otherwise makes Turbopack
    // ambiguous about which lockfile marks the workspace root.
    root: import.meta.dirname,
  },

  /**
   * Baseline security headers. HSTS is applied by Vercel at the edge for
   * custom domains; the rest are declared here so they behave identically
   * in local development and in production.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // Geolocation stays same-origin rather than blocked: optional
            // clock-in location capture needs it in a later milestone.
            value:
              "camera=(), microphone=(), geolocation=(self), payment=(), usb=()",
          },
        ],
      },
      {
        // The service worker must never be cached, or clients can become
        // permanently stranded on a superseded build.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
