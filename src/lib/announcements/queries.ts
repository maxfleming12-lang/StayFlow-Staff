import { createClient } from "@/lib/supabase/server";
import type {
  AnnouncementCategory,
  AnnouncementStatus,
  Recipient,
} from "./status";

/**
 * Announcement queries.
 *
 * RLS does the targeting: `announcements_select_targeted` returns a
 * published, unexpired notice to somebody it was aimed at, and
 * `announcements_select_management` returns everything to a manager. So
 * neither query re-implements the audience rules — doing so would be a
 * second, drifting copy of the one that actually decides.
 */

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  isUrgent: boolean;
  status: AnnouncementStatus;
  requiresAck: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  recipients: Recipient[];
  /** The caller's own acknowledgement, when there is one. */
  myAck: { readAt: string | null; acknowledgedAt: string | null } | null;
  /** Management only: how many people have acknowledged. */
  ackCount: number;
}

const SELECT = `id, title, body, category, is_urgent, status, requires_ack,
  published_at, expires_at`;

const LIMIT = 200;

function mapRow(
  row: Record<string, unknown>,
  recipients: Recipient[],
  myAck: AnnouncementRow["myAck"],
  ackCount: number,
): AnnouncementRow {
  return {
    id: String(row.id),
    title: String(row.title),
    body: String(row.body),
    category: String(row.category) as AnnouncementCategory,
    isUrgent: Boolean(row.is_urgent),
    status: String(row.status) as AnnouncementStatus,
    requiresAck: Boolean(row.requires_ack),
    publishedAt: (row.published_at as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    recipients,
    myAck,
    ackCount,
  };
}

/**
 * Notices for the caller.
 *
 * `forManagement` widens the read to drafts and withdrawn notices, which
 * only a manager's policy returns anyway — passing it as a staff member
 * simply gets the same list back.
 */
export async function getAnnouncements(
  userId: string,
  options: { forManagement?: boolean } = {},
): Promise<AnnouncementRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("announcements")
    .select(SELECT)
    .is("archived_at", null)
    .order("published_at", { ascending: false, nullsFirst: true })
    .limit(LIMIT);

  if (!options.forManagement) query = query.eq("status", "published");

  const { data, error } = await query;
  if (error) throw new Error(`Could not load announcements: ${error.message}`);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const ids = rows.map((row) => String(row.id));
  if (ids.length === 0) return [];

  const [recipientRes, ackRes] = await Promise.all([
    supabase
      .from("announcement_recipients")
      .select("announcement_id, user_id, team_id, property_id, all_staff")
      .in("announcement_id", ids),
    supabase
      .from("announcement_acknowledgements")
      .select("announcement_id, user_id, read_at, acknowledged_at")
      .in("announcement_id", ids),
  ]);

  const recipients = new Map<string, Recipient[]>();
  for (const row of recipientRes.data ?? []) {
    const key = String(row.announcement_id);
    recipients.set(key, [
      ...(recipients.get(key) ?? []),
      {
        allStaff: Boolean(row.all_staff),
        userId: (row.user_id as string | null) ?? null,
        teamId: (row.team_id as string | null) ?? null,
        propertyId: (row.property_id as string | null) ?? null,
      },
    ]);
  }

  const myAcks = new Map<string, AnnouncementRow["myAck"]>();
  const ackCounts = new Map<string, number>();
  for (const row of ackRes.data ?? []) {
    const key = String(row.announcement_id);
    if (row.acknowledged_at) {
      ackCounts.set(key, (ackCounts.get(key) ?? 0) + 1);
    }
    if (String(row.user_id) === userId) {
      myAcks.set(key, {
        readAt: (row.read_at as string | null) ?? null,
        acknowledgedAt: (row.acknowledged_at as string | null) ?? null,
      });
    }
  }

  return rows.map((row) =>
    mapRow(
      row,
      recipients.get(String(row.id)) ?? [],
      myAcks.get(String(row.id)) ?? null,
      ackCounts.get(String(row.id)) ?? 0,
    ),
  );
}
