import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { KIOSK_COOKIE } from "@/lib/kiosk/session";

export const dynamic = "force-dynamic";

/**
 * Exchange a one-time kiosk link for the device cookie.
 *
 * A Route Handler rather than a page because cookies cannot be set during a
 * page render — Next.js only permits it in a Server Action or Route Handler.
 *
 * The token arrives in the URL because a manager has to get it onto the
 * tablet somehow. It is swapped for an httpOnly cookie and the browser is
 * redirected immediately, so the credential does not linger in the address
 * bar, the browser history, or a screenshot of the front desk.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const invalid = NextResponse.redirect(new URL("/kiosk?invalid=1", request.url));

  if (token.length < 32 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return invalid;
  }

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch {
    return invalid;
  }

  const { data } = await admin
    .from("kiosk_sessions")
    .select("id, expires_at, revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (!data || data.revoked_at !== null) return invalid;

  const expires = new Date(String(data.expires_at));
  if (expires < new Date()) return invalid;

  const response = NextResponse.redirect(new URL("/kiosk", request.url));
  response.cookies.set(KIOSK_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires,
    // Scoped so the kiosk credential is never sent to the rest of the app.
    path: "/kiosk",
  });

  return response;
}
