import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";

/**
 * Serve one document, briefly.
 *
 * This is the only way a file leaves the bucket, and the whole design rests
 * on one idea: ACCESS IS DECIDED BY THE DOCUMENTS TABLE, NOT BY STORAGE.
 *
 *   1. The document row is read with the CALLER'S OWN session, so
 *      `documents_select` answers "may this person have this?" — weighing
 *      role, team and property permissions exactly once, in the place those
 *      rules already live.
 *   2. Only if that returns a row does the service-role client mint a signed
 *      URL, valid for a minute.
 *
 * The bucket itself has no policies for `authenticated` (migration 0016), so
 * there is no second copy of the permission rules to drift out of step with
 * the first.
 *
 * A missing document and a forbidden one both 404. Distinguishing them would
 * confirm that a document exists to somebody not allowed to read it, and its
 * title is often the sensitive part — "Investigation into ..." tells you
 * plenty on its own.
 */

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Long enough to start a download, short enough that a shared link dies. */
const SIGNED_URL_SECONDS = 60;

function notFound(): Response {
  return new Response(null, { status: 404 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { id } = await params;

  if (!UUID.test(id)) return notFound();

  const supabase = await createClient();

  // The caller's own client. RLS is the access check.
  const { data: document, error } = await supabase
    .from("documents")
    .select("id, title, storage_path, mime_type")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();

  if (error || !document) return notFound();

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch {
    // Misconfigured server. Do not describe the problem to the caller.
    return notFound();
  }

  const { data: signed, error: signError } = await admin.storage
    .from("staff-documents")
    .createSignedUrl(String(document.storage_path), SIGNED_URL_SECONDS, {
      // Named for the reader, not for the storage path, which is a uuid.
      download: String(document.title),
    });

  if (signError || !signed?.signedUrl) return notFound();

  // Reading counts as reading, whether or not they later acknowledge. Best
  // effort: a failure here must not stop the file being served.
  await supabase.from("document_acknowledgements").upsert(
    {
      organisation_id: user.organisationId,
      document_id: id,
      user_id: user.id,
      read_at: new Date().toISOString(),
    },
    { onConflict: "document_id,user_id", ignoreDuplicates: false },
  );

  const response = NextResponse.redirect(signed.signedUrl, { status: 302 });
  // The redirect carries a credential in its Location header.
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
