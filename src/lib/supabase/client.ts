"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { publishableKey, supabaseUrl } from "./env";

/**
 * Create a Supabase client for use in Client Components.
 *
 * Uses the publishable (anon) key only. Every request it makes is evaluated
 * against Row Level Security using the signed-in user's JWT, so the browser
 * can never read rows the database will not release to that user.
 */
export function createClient() {
  return createBrowserClient<Database>(supabaseUrl(), publishableKey());
}
