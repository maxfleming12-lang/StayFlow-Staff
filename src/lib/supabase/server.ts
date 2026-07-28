import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { publishableKey, supabaseUrl } from "./env";

/**
 * Create a Supabase client for use in Server Components, Server Actions and
 * Route Handlers.
 *
 * The client is bound to the request's cookie jar so that the caller acts as
 * the signed-in user. Because it uses the publishable (anon) key, every query
 * it makes is subject to Row Level Security — which is precisely what we want
 * for user-facing reads and writes.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), publishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `cookies()` is read-only when called from a Server Component.
          // Session refresh is handled by proxy.ts, so ignoring this is safe.
        }
      },
    },
  });
}

/**
 * Create a Supabase client that bypasses Row Level Security using the
 * service-role key.
 *
 * Use this only for trusted server-side operations that genuinely cannot be
 * expressed under RLS — for example provisioning the first owner, or sending
 * push notifications on behalf of the system.
 *
 * This module must never be imported by client code. The guard below throws
 * loudly if that ever happens, and the key has no `NEXT_PUBLIC_` prefix so it
 * is not inlined into the browser bundle.
 *
 * @throws if called in a browser context or if the key is not configured.
 */
export function createServiceRoleClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "createServiceRoleClient() was called in the browser. The service-role key must never reach client code.",
    );
  }

  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. It is required for server-side administrative operations.",
    );
  }

  return createServerClient<Database>(supabaseUrl(), secret, {
    cookies: {
      // A service-role client is not tied to any user session.
      getAll: () => [],
      setAll: () => {},
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
