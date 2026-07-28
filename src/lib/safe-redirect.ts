/**
 * Constrain a caller-supplied redirect target to a same-origin path.
 *
 * `next` parameters arrive in URLs that may have been forwarded, shared or
 * deliberately crafted. Following one unchecked is an open redirect: a link
 * could bounce a staff member to a look-alike sign-in page at the exact
 * moment they expect to land in the app, which is when they are least
 * likely to check the address bar.
 *
 * Anything that is not a plain absolute path falls back to "/".
 *
 * @param value the untrusted redirect target
 * @returns a safe same-origin path
 */
export function safeRedirectPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "/";

  // Must be an absolute path. Rejects "https://evil.com" and "evil.com".
  if (!value.startsWith("/")) return "/";

  // Rejects protocol-relative URLs such as "//evil.com", which the browser
  // resolves against the current scheme and sends off-origin.
  if (value.startsWith("//")) return "/";

  // Some browsers normalise backslashes to slashes, so "/\evil.com" can
  // escape the origin. "://" catches any embedded scheme.
  if (value.includes("\\") || value.includes("://")) return "/";

  // Control characters (including CR and LF) enable header and log
  // injection. Checked by code point so the source stays free of literal
  // control bytes.
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return "/";
  }

  return value;
}
