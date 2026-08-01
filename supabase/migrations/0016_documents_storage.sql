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

-- Belt and braces: if a policy is ever added to storage.objects by hand,
-- this comment is where to look first.
comment on table storage.objects is
  'Files. The staff-documents bucket is private and has NO authenticated
   policies by design — access is decided by documents_select and served
   through server-issued signed URLs. See migration 0016.';
