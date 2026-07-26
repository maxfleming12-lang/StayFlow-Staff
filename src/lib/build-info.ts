/**
 * Build metadata, injected by next.config.ts at build time.
 *
 * These values are never hand-edited. On Vercel the commit SHA and
 * environment come from the platform; the build date is stamped when the
 * bundle is produced, so the administration screen always shows when the
 * running build was actually made.
 */
export const BUILD_INFO = {
  version: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0",
  buildDate: process.env.NEXT_PUBLIC_BUILD_DATE ?? new Date(0).toISOString(),
  commitSha: process.env.NEXT_PUBLIC_COMMIT_SHA ?? "unknown",
  environment: process.env.NEXT_PUBLIC_BUILD_ENV ?? "development",
} as const;
