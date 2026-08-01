"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Upload } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/field";
import {
  uploadDocument,
  type DocumentActionState,
} from "@/lib/documents/actions";
import {
  ALLOWED_MIME_TYPES,
  DOCUMENT_FOLDERS,
  MAX_DOCUMENT_BYTES,
} from "@/lib/documents/folders";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? "Uploading…" : "Add document"}
    </Button>
  );
}

const SELECT_CLASS =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

/** Add a document to the library. */
export function DocumentUpload({
  properties,
}: {
  properties: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState("all");
  const [state, action] = useActionState<DocumentActionState, FormData>(
    uploadDocument,
    {},
  );

  if (!open) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        {state.success && (
          <div className="mb-3">
            <Alert tone="success">{state.success}</Alert>
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

      {state.success && (
        <div className="mt-3">
          <Alert tone="success">{state.success}</Alert>
        </div>
      )}

      <form action={action} className="mt-4 space-y-4">
        <Field label="Title" htmlFor="doc-title" error={state.fieldErrors?.title}>
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
          error={state.fieldErrors?.file}
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
              error={state.fieldErrors?.propertyId}
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

        {state.error && <Alert tone="error">{state.error}</Alert>}

        <div className="flex gap-2">
          <SubmitButton />
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </form>
    </section>
  );
}
