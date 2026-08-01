import type { Metadata } from "next";
import { FolderOpen } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getDocuments } from "@/lib/documents/queries";
import { DocumentList } from "@/components/documents/document-list";
import { DocumentUpload } from "@/components/documents/document-upload";

export const metadata: Metadata = { title: "Documents · StayFlow Staff" };
export const dynamic = "force-dynamic";

/**
 * The staff document library.
 *
 * `documents_select` decides what is listed: a manager sees the whole
 * organisation, everybody else sees documents whose permissions match their
 * role, team or property. Files themselves never appear as links — each is
 * fetched through `/api/documents/[id]`, which re-checks access and issues
 * a URL that lives for a minute.
 */
export default async function DocumentsPage() {
  const user = await requireUser();
  const canManage = atLeast(user.role, "manager");

  const supabase = await createClient();
  const [documents, propertyRes] = await Promise.all([
    getDocuments(user.id),
    supabase
      .from("properties")
      .select("id, name")
      .eq("is_active", true)
      .is("archived_at", null)
      .order("name"),
  ]);

  if (propertyRes.error) {
    throw new Error(`Could not load properties: ${propertyRes.error.message}`);
  }

  const properties = (propertyRes.data ?? []).map((p) => ({
    id: String(p.id),
    name: String(p.name),
  }));

  const toRead = documents.filter(
    (d) => d.requiresAck && !d.myAck?.acknowledgedAt,
  ).length;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Documents
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          {toRead > 0
            ? `${toRead} document${toRead === 1 ? "" : "s"} waiting for you to confirm.`
            : "Policies, procedures and forms you are permitted to read."}
        </p>
      </div>

      {canManage && <DocumentUpload properties={properties} />}

      {documents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
          <FolderOpen
            className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
            strokeWidth={1.5}
          />
          <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
            Nothing here yet
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {canManage
              ? "Add a policy or procedure above and choose who can read it."
              : "Documents your manager shares with you will appear here."}
          </p>
        </div>
      ) : (
        <DocumentList documents={documents} canManage={canManage} />
      )}
    </div>
  );
}
