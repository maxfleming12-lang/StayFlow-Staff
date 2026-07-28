/**
 * iCalendar (RFC 5545) generation.
 *
 * Deliberately hand-rolled rather than pulled from a library: the subset
 * needed here is small, and the two things that actually break real calendar
 * clients — text escaping and line folding — are easy to get wrong silently.
 * A malformed feed does not error, it just quietly stops importing.
 */

export interface CalendarEvent {
  /** Stable across regenerations, so clients update rather than duplicate. */
  uid: string;
  startsAt: Date | string;
  endsAt: Date | string;
  summary: string;
  location?: string | null;
  description?: string | null;
}

/**
 * Escape a text value per RFC 5545 §3.3.11.
 *
 * Backslash must be escaped FIRST, otherwise the backslashes introduced by
 * the later replacements get escaped again and the output is corrupted.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Fold a content line to 75 octets per RFC 5545 §3.1.
 *
 * The limit is octets, not characters, so a naive slice would split a
 * multi-byte character in half — a motel note containing "café" or an emoji
 * is enough to produce an invalid feed. This measures in UTF-8 bytes and
 * never splits a character.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  // Continuation lines start with a space, which itself costs one octet.
  let limit = 75;

  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    if (currentBytes + charBytes > limit) {
      parts.push(current);
      current = char;
      currentBytes = charBytes;
      limit = 74;
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }
  if (current) parts.push(current);

  return parts.join("\r\n ");
}

/** Format an instant as a UTC iCalendar timestamp: 20260803T090000Z. */
export function formatIcsDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Build a complete VCALENDAR document.
 *
 * Lines are joined with CRLF, which RFC 5545 requires — some clients accept
 * bare LF, and some silently reject the whole feed.
 */
export function buildCalendar(options: {
  calendarName: string;
  events: CalendarEvent[];
  /** Stamped on every event; passed in so output is deterministic to test. */
  now?: Date;
}): string {
  const stamp = formatIcsDate(options.now ?? new Date());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StayFlow Staff//Roster//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(options.calendarName)}`,
    "X-WR-TIMEZONE:Australia/Sydney",
    // Ask clients to re-poll roughly every four hours. Advisory only.
    "REFRESH-INTERVAL;VALUE=DURATION:PT4H",
    "X-PUBLISHED-TTL:PT4H",
  ];

  for (const event of options.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatIcsDate(event.startsAt)}`,
      `DTEND:${formatIcsDate(event.endsAt)}`,
      `SUMMARY:${escapeText(event.summary)}`,
    );
    if (event.location) {
      lines.push(`LOCATION:${escapeText(event.location)}`);
    }
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}
