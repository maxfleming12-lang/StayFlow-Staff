import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js Proxy (formerly Middleware, renamed in Next.js 16).
 *
 * Responsibilities, deliberately narrow:
 *   1. Refresh the Supabase auth session cookie on every navigation, so a
 *      signed-in user is not silently logged out when their token expires.
 *   2. Perform an *optimistic* redirect for unauthenticated visitors.
 *
 * This is NOT the authorisation boundary. Per the Next.js documentation,
 * proxy should not be used as a full session management or authorisation
 * solution. Real enforcement happens in two places that a browser cannot
 * bypass:
 *   - server-side checks in each protected route (see src/lib/auth/session.ts)
 *   - Row Level Security policies in Postgres
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without configuration there is no session to refresh. Let the request
  // through so the app can render its own "not configured" guidance rather
  // than failing with an opaque proxy error.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates the token with Supabase rather than trusting the
  // cookie's contents, and refreshes it when required.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!user && !isPublic) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    // Preserve where the user was heading so login can return them there.
    redirectUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(redirectUrl);
  }

  // A signed-in user has no reason to sit on the login screen.
  if (user && pathname === "/login") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

/** Routes reachable without an authenticated session. */
const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/offline",
  "/install",
];

export const config = {
  /**
   * Run on everything except static assets and the PWA files. Without a
   * matcher, proxy would also intercept CSS, JS, icons and the service
   * worker, which would break offline support and slow every asset request.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/.*|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
