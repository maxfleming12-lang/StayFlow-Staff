"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/field";
import { createClient } from "@/lib/supabase/client";
import {
  finaliseDocumentUpload,
  prepareDocumentUpload,
} from "@/lib/documents/actions";
import {
  ALLOWED_MIME_TYPES,
  DOCUMENT_BUCKET,
  DOCUMENT_FOLDERS,
  MAX_DOCUMENT_BYTES,
  checkFile,
} from "@/lib/documents/folders";

const SELECT_CLASS =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

/**
 * Add a document to the library.
 *
 * The file does NOT go through a server action. The server hands back a
 * single-use signed upload URL and the browser sends the bytes straight to
 * storage — a server action's body is capped at 1 MB by default, and at
 * about 4.5 MB by Vercel regardless, so anything larger than a small PDF
 * failed before the action ran.
 *
 * Three steps, so a failure at any point says which one.
 */
export function DocumentUpload({
  properties,
}: {
  properties: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");

    setError(null);
    setFieldErrors({});
    setSuccess(null);

    if (!(file instanceof File) || file.size === 0) {
      setFieldErrors({ file: "Choose a file." });
      return;
    }

    // Checked here first so an obviously wrong file costs no round trip.
    const check = checkFile({ size: file.size, type: file.type });
    if (!check.ok) {
      setFieldErrors({ file: check.reason });
      return;
    }

    const metadata = {
      title: String(data.get("title") ?? ""),
      description: String(data.get("description") ?? "") || undefined,
      folder: String(data.get("folder") ?? "Policies"),
      requiresAck: data.get("requiresAck") === "on",
      audience: String(data.get("audience") ?? "all"),
      propertyId: String(data.get("propertyId") ?? "") || undefined,
    };

    try {
      setBusy("Checking…");
      const prepared = await prepareDocumentUpload({
        ...metadata,
        filename: file.name,
        size: file.size,
        mimeType: file.type,
      });

      if (prepared.error || !prepared.ticket) {
        setFieldErrors(prepared.fieldErrors ?? {});
        setError(prepared.error ?? "Could not start the upload.");
        return;
      }

      setBusy("Uploading…");
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .uploadToSignedUrl(prepared.ticket.path, prepared.ticket.token, file, {
          contentType: file.type,
        });

      if (uploadError) {
        setError(`The file did not upload: ${uploadError.message}`);
        return;
      }

      setBusy("Saving…");
      const finalised = await finaliseDocumentUpload({
        ...metadata,
        path: prepared.ticket.path,
        size: file.size,
        mimeType: file.type,
      });

      if (finalised.error) {
        setError(finalised.error);
        return;
      }

      setSuccess(finalised.success ?? "Document added.");
      form.reset();
      setOpen(false);
    } catch (caught) {
      // Say which step failed and why. A bare "cannot reach StayFlow" sends
      // somebody to check their wifi when the cause is a configuration
      // problem only this message would reveal.
      const detail = caught instanceof Error ? caught.message : "";
      setError(
        detail
          ? `Upload failed while ${busy ?? "starting"}: ${detail}`
          : "Upload failed. Try again shortly.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        {success && (
          <div className="mb-3">
            <Alert tone="success">{success}</Alert>
          </div>
        )}
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Upload className="h-4 w-4" aria-hidden="true" />
          Add a document
        </Button>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="document-upload-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2
        id="document-upload-heading"
        className="text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        Add a document
      </h2>

      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <Field label="Title" htmlFor="doc-title" error={fieldErrors.title}>
          <Input
            id="doc-title"
            name="title"
            required
            maxLength={200}
            placeholder="Fire and emergency procedure"
          />
        </Field>

        <Field
          label="File"
          htmlFor="doc-file"
          error={fieldErrors.file}
          hint={`PDF, image, Word or Excel, up to ${Math.round(MAX_DOCUMENT_BYTES / 1_048_576)} MB.`}
        >
          <input
            id="doc-file"
            name="file"
            type="file"
            required
            accept={ALLOWED_MIME_TYPES.join(",")}
            className="block w-full text-sm text-slate-900 file:mr-3 file:h-11 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:text-sm file:font-medium file:text-slate-900 dark:text-slate-100 dark:file:bg-slate-800 dark:file:text-slate-100"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Folder" htmlFor="doc-folder">
            <select
              id="doc-folder"
              name="folder"
              defaultValue="Policies"
              className={SELECT_CLASS}
            >
              {DOCUMENT_FOLDERS.map((folder) => (
                <option key={folder} value={folder}>
                  {folder}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Who can read it" htmlFor="doc-audience">
            <select
              id="doc-audience"
              name="audience"
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              className={SELECT_CLASS}
            >
              <option value="all">All staff</option>
              <option value="property">One property</option>
            </select>
          </Field>

          {audience === "property" && (
            <Field
              label="Property"
              htmlFor="doc-property"
              error={fieldErrors.propertyId}
            >
              <select
                id="doc-property"
                name="propertyId"
                defaultValue={properties[0]?.id}
                className={SELECT_CLASS}
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="doc-description">What it is</Label>
          <textarea
            id="doc-description"
            name="description"
            rows={2}
            maxLength={1000}
            placeholder="What to do and where to assemble if the alarm sounds."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            name="requiresAck"
            className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 dark:border-slate-600"
          />
          <span>Ask staff to confirm they have read it.</span>
        </label>

        {error && <Alert tone="error">{error}</Alert>}

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={Boolean(busy)} aria-busy={Boolean(busy)}>
            {busy ?? "Add document"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={Boolean(busy)}
            onClick={() => setOpen(false)}
          >
            Close
          </Button>
        </div>
      </form>
    </section>
  );
}
