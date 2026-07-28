/**
 * Centralised, validated access to Supabase environment variables.
 *
 * Reading these through accessor functions (rather than inline
 * `process.env.X!` assertions) means a misconfigured deployment fails with a
 * message that says exactly which variable is missing, instead of a vague
 * runtime error deep inside the Supabase SDK.
 */

/** Read a required public variable, or throw a message naming it. */
function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in — see README.md.`,
    );
  }
  return value;
}

/** The Supabase project URL, e.g. https://abcdefgh.supabase.co */
export function supabaseUrl(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
}

/**
 * The Supabase publishable (anon) key.
 *
 * This key is safe to expose to browsers: on its own it grants nothing,
 * because every table is protected by Row Level Security.
 */
export function publishableKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * The canonical origin of this deployment, used to build absolute redirect
 * URLs for password reset and email confirmation links.
 *
 * Falls back to the Vercel-provided URL, then to localhost for development.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}
