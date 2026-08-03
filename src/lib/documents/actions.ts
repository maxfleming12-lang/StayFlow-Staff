"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth/session";
import {
  DOCUMENT_BUCKET,
  DOCUMENT_FOLDERS,
  checkFile,
  extensionOf,
  storagePathFor,
} from "./folders";

/**
 * Keep the real reason.
 *
 * These actions are manager-only and every throw they can produce is a
 * configuration or storage fault — "SUPABASE_SECRET_KEY is not set", "Bucket
 * not found". Replacing those with "cannot reach StayFlow" tells somebody to
 * check their signal when the answer is a missing environment variable, and
 * leaves nobody any way to find out which.
 */
function describe(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message ? `${fallback} (${message})` : fallback;
}

export interface DocumentActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Uploading, in two steps, with the file going nowhere near this server.
 *
 * The obvious design — post the file to a server action — cannot work here.
 * A Next.js server action caps its request body at 1 MB by default, and
 * Vercel caps a serverless function's body at about 4.5 MB whatever the
 * framework says. The library accepts files up to 25 MB, so anything bigger
 * than a small PDF failed before the action ever ran, which is why it
 * surfaced as a server error rather than a message in the form.
 *
 * So: the server mints a single-use signed upload URL for a path IT chooses,
 * the browser sends the bytes straight to storage, and a second action
 * records the row. The bucket stays private throughout — a signed upload URL
 * grants one write to one path and nothing else.
 */

const metadataSchema = z.object({
  title: z.string().trim().min(1, "Give the document a title.").max(200),
  description: z.string().trim().max(1000).optional(),
  folder: z.enum(DOCUMENT_FOLDERS),
  requiresAck: z.boolean(),
  audience: z.enum(["all", "property"]),
  propertyId: z.string().uuid().optional(),
});

const prepareSchema = metadataSchema.extend({
  filename: z.string().trim().min(1).max(300),
  size: z.number().int().nonnegative(),
  mimeType: z.string().trim().max(200),
});

export interface UploadTicket {
  error?: string;
  fieldErrors?: Record<string, string>;
  ticket?: { path: string; token: string };
}

/**
 * Step one: check the metadata and hand back a ticket to upload with.
 *
 * The PATH IS CHOSEN HERE, never by the caller. It is
 * `{organisation}/{random}.{ext}`, so a signed URL cannot be talked into
 * writing over another document, or into another organisation's prefix.
 */
export async function prepareDocumentUpload(
  input: unknown,
): Promise<UploadTicket> {
  const user = await requireRole("manager");

  const parsed = prepareSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors, error: "Check the highlighted fields." };
  }

  const data = parsed.data;

  // Checked here as well as by the bucket, so somebody is told why before
  // waiting for an upload that storage would refuse.
  const check = checkFile({ size: data.size, type: data.mimeType });
  if (!check.ok) {
    return { fieldErrors: { file: check.reason }, error: check.reason };
  }

  if (data.audience === "property" && !data.propertyId) {
    return {
      fieldErrors: { propertyId: "Choose which property." },
      error: "Choose which property this is for.",
    };
  }

  const path = storagePathFor(
    user.organisationId,
    randomUUID(),
    extensionOf(data.filename),
  );

  try {
    const admin = createServiceRoleClient();
    const { data: signed, error } = await admin.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUploadUrl(path);

    if (error || !signed) {
      // The commonest cause by far is the bucket not existing yet.
      return {
        error: `Could not start the upload: ${error?.message ?? "no upload URL"}. If this is a new deployment, check migration 0016 has been applied.`,
      };
    }

    return { ticket: { path: signed.path, token: signed.token } };
  } catch (error) {
    return { error: describe(error, "Could not start the upload.") };
  }
}

const finaliseSchema = metadataSchema.extend({
  path: z.string().min(1).max(400),
  size: z.number().int().nonnegative(),
  mimeType: z.string().trim().max(200),
});

/**
 * Step two: record the document, now the file is actually in the bucket.
 *
 * The row is created only AFTER a successful upload, so it can never point
 * at a file that is not there — a broken link in a list of policies is worse
 * than a missing entry. The reverse trade is an orphaned object if somebody
 * closes the tab mid-upload, which costs a little storage and nothing else.
 */
export async function finaliseDocumentUpload(
  input: unknown,
): Promise<DocumentActionState> {
  const user = await requireRole("manager");

  const parsed = finaliseSchema.safeParse(input);
  if (!parsed.success) return { error: "That upload could not be completed." };
  const data = parsed.data;

  // The path came back through the browser, so it is not trusted. It must
  // sit under this organisation's prefix, or a crafted call could attach a
  // row to somebody else's file.
  if (!data.path.startsWith(`${user.organisationId}/`)) {
    return { error: "That upload could not be completed." };
  }

  if (data.audience === "property" && !data.propertyId) {
    return { error: "Choose which property this is for." };
  }

  let documentId: string | null = null;

  try {
    const supabase = await createClient();
    const admin = createServiceRoleClient();

    // Confirm the object is really there before recording it.
    const { data: found, error: listError } = await admin.storage
      .from(DOCUMENT_BUCKET)
      .list(user.organisationId, {
        search: data.path.split("/").pop() ?? "",
        limit: 1,
      });

    if (listError || !found || found.length === 0) {
      return { error: "The file did not finish uploading. Try again." };
    }

    const { data: created, error: insertError } = await supabase
      .from("documents")
      .insert({
        organisation_id: user.organisationId,
        property_id: data.audience === "property" ? data.propertyId! : null,
        folder: data.folder,
        title: data.title,
        description: data.description ?? null,
        storage_path: data.path,
        mime_type: data.mimeType,
        file_size_bytes: data.size,
        requires_ack: data.requiresAck,
        created_by: user.id,
      })
      .select("id")
      .maybeSingle();

    if (insertError || !created) {
      await admin.storage.from(DOCUMENT_BUCKET).remove([data.path]);
      return { error: `Could not save that document: ${insertError?.message ?? ""}` };
    }
    documentId = String(created.id);

    // Without a permission row the document is visible to management only —
    // the safe default for an accidental upload, but not what was asked for.
    const { error: permissionError } = await supabase
      .from("document_permissions")
      .insert(
        data.audience === "property"
          ? {
              organisation_id: user.organisationId,
              document_id: documentId,
              property_id: data.propertyId!,
            }
          : {
              organisation_id: user.organisationId,
              document_id: documentId,
              role: "staff" as const,
            },
      );

    if (permissionError) {
      await supabase.from("documents").delete().eq("id", documentId);
      await admin.storage.from(DOCUMENT_BUCKET).remove([data.path]);
      return {
        error:
          "The document uploaded but could not be shared, so it has been removed. Try again.",
      };
    }
  } catch (error) {
    return { error: describe(error, "Could not save that document.") };
  }

  revalidatePath("/documents");
  return { success: "Document added." };
}

const ackSchema = z.object({ id: z.string().uuid() });

/** Record that the caller has read and acknowledged a document. */
export async function acknowledgeDocument(
  _prev: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const user = await requireUser();

  const parsed = ackSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "That document could not be identified." };

  const now = new Date().toISOString();

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("document_acknowledgements").upsert(
      {
        organisation_id: user.organisationId,
        document_id: parsed.data.id,
        user_id: user.id,
        read_at: now,
        acknowledged_at: now,
      },
      { onConflict: "document_id,user_id" },
    );

    if (error) return { error: "Could not record that." };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }

  revalidatePath("/documents");
  return { success: "Thanks — your manager can see you have read this." };
}

const archiveSchema = z.object({ id: z.string().uuid() });

/**
 * Remove a document from the library.
 *
 * Archived, not deleted, and the file stays in the bucket. Who acknowledged
 * which policy, and when, is exactly the record an employer needs to keep,
 * and it is worth nothing if the document it refers to has gone.
 */
export async function archiveDocument(
  _prev: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  await requireRole("manager");

  const parsed = archiveSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "That document could not be identified." };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("documents")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", parsed.data.id)
      .is("archived_at", null)
      .select("id")
      .maybeSingle();

    if (error) return { error: "Could not remove that document." };
    if (!data) return { error: "That document has already been removed." };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }

  revalidatePath("/documents");
  return { success: "Document removed from the library." };
}
