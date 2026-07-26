import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

/**
 * OAuth/PKCE callback.
 *
 * Supabase sends the user here from emailed links (password recovery, email
 * confirmation) carrying a one-time `code`. Exchanging it establishes the
 * session cookie, after which the user is forwarded to `next`.
 *
 * `next` is untrusted input and is constrained to a same-origin path — an
 * open redirect immediately after establishing a valid session would be
 * about the most damaging moment for one.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Recovery links are single-use and time-limited; an expired one lands here.
    return NextResponse.redirect(`${origin}/login?error=invalid_link`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
