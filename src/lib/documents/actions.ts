"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth/session";
import {
  DOCUMENT_FOLDERS,
  checkFile,
  extensionOf,
  storagePathFor,
} from "./folders";

export interface DocumentActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
}

const uploadSchema = z.object({
  title: z.string().trim().min(1, "Give the document a title.").max(200),
  description: z.string().trim().max(1000).optional(),
  folder: z.enum(DOCUMENT_FOLDERS),
  requiresAck: z.boolean(),
  audience: z.enum(["all", "property"]),
  propertyId: z.string().uuid().optional(),
});

/**
 * Add a document to the library.
 *
 * The row is written FIRST, then the file, then the permission that makes it
 * visible. That order matters: the row supplies the id the storage path is
 * built from, so the file can be named by something unguessable rather than
 * by its title.
 *
 * If the upload or the permission fails, the row is removed again. A
 * document with no file is a broken link in a list of policies, and one with
 * no permission row is invisible to everybody except management — both are
 * worse than a clear failure.
 */
export async function uploadDocument(
  _prev: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const user = await requireRole("manager");

  const parsed = uploadSchema.safeParse({
    title: formData.get("title"),
    description: (formData.get("description") as string) || undefined,
    folder: (formData.get("folder") as string) || "Policies",
    requiresAck: formData.get("requiresAck") === "on",
    audience: (formData.get("audience") as string) || "all",
    propertyId: (formData.get("propertyId") as string) || undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors, error: "Check the highlighted fields." };
  }

  const input = parsed.data;
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { fieldErrors: { file: "Choose a file." }, error: "Choose a file." };
  }

  // Checked here as well as by the bucket, so somebody is told why before
  // waiting for an upload to fail.
  const check = checkFile({ size: file.size, type: file.type });
  if (!check.ok) {
    return { fieldErrors: { file: check.reason }, error: check.reason };
  }

  if (input.audience === "property" && !input.propertyId) {
    return {
      fieldErrors: { propertyId: "Choose which property." },
      error: "Choose which property this is for.",
    };
  }

  let documentId: string | null = null;

  try {
    const supabase = await createClient();

    const { data: created, error: insertError } = await supabase
      .from("documents")
      .insert({
        organisation_id: user.organisationId,
        property_id: input.audience === "property" ? input.propertyId! : null,
        folder: input.folder,
        title: input.title,
        description: input.description ?? null,
        // Rewritten below, once the id exists to name the file by.
        storage_path: "pending",
        mime_type: file.type,
        file_size_bytes: file.size,
        requires_ack: input.requiresAck,
        created_by: user.id,
      })
      .select("id")
      .maybeSingle();

    if (insertError || !created) {
      return { error: `Could not save that document: ${insertError?.message ?? ""}` };
    }
    documentId = String(created.id);

    const path = storagePathFor(
      user.organisationId,
      documentId,
      extensionOf(file.name),
    );

    // The bucket is private and has no policies for authenticated users, so
    // the upload goes through the service role. The role check above and
    // `documents_write_manager` on the row are what authorise it.
    const admin = createServiceRoleClient();
    const { error: uploadError } = await admin.storage
      .from("staff-documents")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (uploadError) {
      await supabase.from("documents").delete().eq("id", documentId);
      return { error: `Could not upload the file: ${uploadError.message}` };
    }

    const { error: pathError } = await supabase
      .from("documents")
      .update({ storage_path: path })
      .eq("id", documentId);

    if (pathError) {
      await admin.storage.from("staff-documents").remove([path]);
      await supabase.from("documents").delete().eq("id", documentId);
      return { error: "Could not finish saving that document." };
    }

    // Without a permission row the document is visible to management only —
    // which is the safe default for an accidental upload, but not what was
    // asked for here.
    const { error: permissionError } = await supabase
      .from("document_permissions")
      .insert(
        input.audience === "property"
          ? {
              organisation_id: user.organisationId,
              document_id: documentId,
              property_id: input.propertyId!,
            }
          : {
              organisation_id: user.organisationId,
              document_id: documentId,
              role: "staff" as const,
            },
      );

    if (permissionError) {
      await admin.storage.from("staff-documents").remove([path]);
      await supabase.from("documents").delete().eq("id", documentId);
      return {
        error:
          "The document was uploaded but could not be shared, so it has been removed. Try again.",
      };
    }
  } catch {
    return { error: "Cannot reach StayFlow right now. Try again shortly." };
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
