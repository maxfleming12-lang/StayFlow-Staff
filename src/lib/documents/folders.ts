/**
 * Document folders and file rules.
 *
 * Pure, so it can be tested. The bucket enforces size and type as well —
 * this exists so somebody choosing a file is told why it was refused before
 * it uploads, rather than after.
 */

export const DOCUMENT_FOLDERS = [
  "Policies",
  "Procedures",
  "Emergency",
  "Training",
  "Forms",
] as const;

export type DocumentFolder = (typeof DOCUMENT_FOLDERS)[number];

export function isDocumentFolder(value: unknown): value is DocumentFolder {
  return (
    typeof value === "string" &&
    (DOCUMENT_FOLDERS as readonly string[]).includes(value)
  );
}

/** The private bucket created in migration 0016. */
export const DOCUMENT_BUCKET = "staff-documents";

/** Matches the bucket's limit in migration 0016. */
export const MAX_DOCUMENT_BYTES = 26_214_400;

/** Matches the bucket's allowed_mime_types in migration 0016. */
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type FileCheck =
  | { ok: true }
  | { ok: false; reason: string };

/** Would the bucket accept this file? */
export function checkFile(file: { size: number; type: string }): FileCheck {
  if (file.size === 0) {
    return { ok: false, reason: "That file is empty." };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    const mb = Math.round(MAX_DOCUMENT_BYTES / 1_048_576);
    return { ok: false, reason: `Files must be ${mb} MB or smaller.` };
  }
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return {
      ok: false,
      reason: "That file type is not accepted. Use a PDF, image, Word or Excel file.",
    };
  }
  return { ok: true };
}

/**
 * Where a file lives in the bucket.
 *
 * Organisation first so one motel group's files can never be listed by
 * guessing another's prefix, then a random segment so the path cannot be
 * derived from the title. The original filename is NOT used: it may contain
 * anything, and a predictable path is one guess away from a signed URL for
 * a document somebody may not read.
 */
export function storagePathFor(
  organisationId: string,
  documentId: string,
  extension: string,
): string {
  const safeExtension = /^[a-z0-9]{1,8}$/i.test(extension)
    ? extension.toLowerCase()
    : "bin";
  return `${organisationId}/${documentId}.${safeExtension}`;
}

/** The extension of an uploaded filename, without the dot. */
export function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : "bin";
}

/** Human file size, for a list a manager reads at a glance. */
export function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
