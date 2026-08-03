"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Download, Eye, FileText } from "lucide-react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatShortDate } from "@/lib/format";
import {
  acknowledgeDocument,
  archiveDocument,
  type DocumentActionState,
} from "@/lib/documents/actions";
import { formatBytes } from "@/lib/documents/folders";
import type { DocumentRow } from "@/lib/documents/queries";

function AckButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? "Saving…" : "I have read this"}
    </Button>
  );
}

function ArchiveButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant="ghost"
      disabled={pending}
      aria-busy={pending}
      className="text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
    >
      {pending ? "Removing…" : "Remove"}
    </Button>
  );
}

function DocumentItem({
  document,
  canManage,
}: {
  document: DocumentRow;
  canManage: boolean;
}) {
  const [ackState, ackAction] = useActionState<DocumentActionState, FormData>(
    acknowledgeDocument,
    {},
  );
  const [archiveState, archiveAction] = useActionState<
    DocumentActionState,
    FormData
  >(archiveDocument, {});

  const acknowledged = Boolean(document.myAck?.acknowledgedAt);
  const needsAck = document.requiresAck && !acknowledged;

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <FileText
          className="mt-0.5 h-5 w-5 shrink-0 text-slate-400"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-slate-900 dark:text-slate-100">
            {document.title}
          </h3>
          {document.description && (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {document.description}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {formatBytes(document.fileSizeBytes)}
            {document.version > 1 && ` · version ${document.version}`}
            {` · added ${formatShortDate(document.createdAt)}`}
            {canManage && document.requiresAck && ` · ${document.ackCount} read`}
          </p>

          {needsAck && (
            <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-300">
              You need to confirm you have read this.
            </p>
          )}
          {acknowledged && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              You have read this.
            </p>
          )}

          {(ackState.error || archiveState.error) && (
            <div className="mt-2">
              <Alert tone="error">{ackState.error ?? archiveState.error}</Alert>
            </div>
          )}
          {(ackState.success || archiveState.success) && (
            <div className="mt-2">
              <Alert tone="success">
                {ackState.success ?? archiveState.success}
              </Alert>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/*
              A plain link. The route checks access against the documents
              table and then redirects to a URL that lives for a minute.
            */}
            <Link
              href={`/api/documents/${document.id}`}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-900 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Open
            </Link>

            {needsAck && (
              <form action={ackAction}>
                <input type="hidden" name="id" value={document.id} />
                <AckButton />
              </form>
            )}

            {canManage && (
              <form action={archiveAction}>
                <input type="hidden" name="id" value={document.id} />
                <ArchiveButton />
              </form>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/** The library, grouped by folder. */
export function DocumentList({
  documents,
  canManage,
}: {
  documents: DocumentRow[];
  canManage: boolean;
}) {
  const folders = [...new Set(documents.map((d) => d.folder))];

  return (
    <div className="space-y-6">
      {folders.map((folder) => {
        const inFolder = documents.filter((d) => d.folder === folder);
        const unread = inFolder.filter(
          (d) => d.requiresAck && !d.myAck?.acknowledgedAt,
        ).length;

        return (
          <section key={folder} aria-labelledby={`folder-${folder}`}>
            <h2
              id={`folder-${folder}`}
              className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100"
            >
              {folder}
              {unread > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <Eye className="h-3 w-3" aria-hidden="true" />
                  {unread} to read
                </span>
              )}
            </h2>
            <ul className="mt-2 space-y-2">
              {inFolder.map((document) => (
                <DocumentItem
                  key={document.id}
                  document={document}
                  canManage={canManage}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
