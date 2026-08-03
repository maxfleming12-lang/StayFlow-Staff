import { createClient } from "@/lib/supabase/server";
import type { DocumentFolder } from "./folders";

/**
 * Document queries.
 *
 * `documents_select` decides visibility: a manager sees everything in the
 * organisation, and everybody else sees only documents with a permission
 * row matching their role, team or property. So nothing here re-implements
 * that — a second copy of an access rule is a second thing to get wrong.
 */

export interface DocumentRow {
  id: string;
  folder: DocumentFolder;
  title: string;
  description: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  version: number;
  requiresAck: boolean;
  createdAt: string;
  /** The caller's own acknowledgement, when there is one. */
  myAck: { readAt: string | null; acknowledgedAt: string | null } | null;
  /** Management only: how many people have acknowledged. */
  ackCount: number;
}

const SELECT = `id, folder, title, description, mime_type, file_size_bytes,
  version, requires_ack, created_at`;

export async function getDocuments(userId: string): Promise<DocumentRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("documents")
    .select(SELECT)
    .is("archived_at", null)
    .order("folder", { ascending: true })
    .order("title", { ascending: true })
    .limit(500);

  if (error) throw new Error(`Could not load documents: ${error.message}`);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const ids = rows.map((row) => String(row.id));
  if (ids.length === 0) return [];

  const { data: acks } = await supabase
    .from("document_acknowledgements")
    .select("document_id, user_id, read_at, acknowledged_at")
    .in("document_id", ids);

  const myAcks = new Map<string, DocumentRow["myAck"]>();
  const ackCounts = new Map<string, number>();
  for (const row of acks ?? []) {
    const key = String(row.document_id);
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

  return rows.map((row) => ({
    id: String(row.id),
    folder: String(row.folder) as DocumentFolder,
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    mimeType: (row.mime_type as string | null) ?? null,
    fileSizeBytes:
      row.file_size_bytes != null ? Number(row.file_size_bytes) : null,
    version: Number(row.version ?? 1),
    requiresAck: Boolean(row.requires_ack),
    createdAt: String(row.created_at),
    myAck: myAcks.get(String(row.id)) ?? null,
    ackCount: ackCounts.get(String(row.id)) ?? 0,
  }));
}
