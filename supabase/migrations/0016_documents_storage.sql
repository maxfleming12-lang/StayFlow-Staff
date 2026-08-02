-- =====================================================================
-- Storage for the staff document library
--
-- The `documents` table has existed since 0002 and its comment describes a
-- PRIVATE bucket served through short-lived signed URLs. Nothing ever
-- created the bucket, so the whole feature had nowhere to put a file.
--
-- Deliberately NO policies on storage.objects for `authenticated`.
--
-- Access to a document is already decided by `documents_select`, which
-- weighs role, team and property permissions. Mirroring that logic into
-- storage policies would be a second copy of the rule that drifts from the
-- first, and the two disagreeing is how a file becomes readable by somebody
-- the document row says may not read it.
--
-- Instead the bucket is reachable only by the service role. A server route
-- asks the DOCUMENTS table — through the caller's own session, so RLS
-- answers — whether this person may have this document, and only then mints
-- a signed URL. One rule, in one place, and the file inherits it.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'staff-documents',
  'staff-documents',
  false,
  26214400, -- 25 MiB: a policy PDF, not a video.
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- NOTE for anyone adding a policy to storage.objects later:
--
-- The staff-documents bucket is private and has NO policies for
-- `authenticated` BY DESIGN. Access is decided by `documents_select` and
-- served through server-issued signed URLs from /api/documents/[id]. Adding
-- a storage policy here would create a second, drifting copy of the access
-- rule — read that route before you do.
--
-- Deliberately a SQL comment rather than `comment on table storage.objects`:
-- that table is owned by `supabase_storage_admin`, so commenting on it needs
-- ownership the migration role does not have, and the statement would fail
-- the whole migration for the sake of a note.
