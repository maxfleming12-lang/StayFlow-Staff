"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, CheckCircle2, Eye } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import {
  acknowledgeAnnouncement,
  withdrawAnnouncement,
  type AnnouncementActionState,
} from "@/lib/announcements/actions";
import {
  ANNOUNCEMENT_STATUS_LABEL,
  describeAudience,
  isLive,
} from "@/lib/announcements/status";
import type { AnnouncementRow } from "@/lib/announcements/queries";
import { cn } from "@/lib/utils";

function Pending({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? busy : label}
    </Button>
  );
}

function WithdrawButton() {
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
      {pending ? "Withdrawing…" : "Withdraw"}
    </Button>
  );
}

/**
 * One notice.
 *
 * A manager sees the audience, the acknowledgement count and a withdraw
 * button; everybody else sees the notice and, when it asks for one, an
 * acknowledgement.
 */
export function AnnouncementCard({
  announcement,
  canManage,
  propertyNames,
}: {
  announcement: AnnouncementRow;
  canManage: boolean;
  propertyNames: Map<string, string>;
}) {
  const [ackState, ackAction] = useActionState<AnnouncementActionState, FormData>(
    acknowledgeAnnouncement,
    {},
  );
  const [withdrawState, withdrawAction] = useActionState<
    AnnouncementActionState,
    FormData
  >(withdrawAnnouncement, {});

  const live = isLive(announcement);
  const acknowledged = Boolean(announcement.myAck?.acknowledgedAt);
  const needsAck = announcement.requiresAck && !acknowledged;

  return (
    <article
      className={cn(
        "rounded-xl border bg-white p-4 dark:bg-slate-900",
        announcement.isUrgent
          ? "border-red-300 dark:border-red-800"
          : "border-slate-200 dark:border-slate-800",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium text-slate-900 dark:text-slate-100">
            {announcement.title}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {announcement.publishedAt
              ? formatDateTime(announcement.publishedAt)
              : ANNOUNCEMENT_STATUS_LABEL[announcement.status]}
            {" · "}
            {announcement.category}
            {canManage && ` · ${describeAudience(announcement.recipients, { properties: propertyNames })}`}
          </p>
        </div>
        {announcement.isUrgent && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-900 dark:bg-red-950 dark:text-red-200">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            Urgent
          </span>
        )}
      </div>

      <p className="mt-3 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">
        {announcement.body}
      </p>

      {announcement.expiresAt && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {live
            ? `Applies until ${formatDateTime(announcement.expiresAt)}`
            : `Expired ${formatDateTime(announcement.expiresAt)}`}
        </p>
      )}

      {canManage && announcement.requiresAck && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          {announcement.ackCount} acknowledged
        </p>
      )}

      {acknowledged && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          You have read this.
        </p>
      )}

      {(ackState.error || withdrawState.error) && (
        <div className="mt-3">
          <Alert tone="error">{ackState.error ?? withdrawState.error}</Alert>
        </div>
      )}
      {(ackState.success || withdrawState.success) && (
        <div className="mt-3">
          <Alert tone="success">{ackState.success ?? withdrawState.success}</Alert>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {needsAck && live && (
          <form action={ackAction}>
            <input type="hidden" name="id" value={announcement.id} />
            <Pending label="I have read this" busy="Saving…" />
          </form>
        )}

        {canManage && announcement.status !== "withdrawn" && (
          <form action={withdrawAction}>
            <input type="hidden" name="id" value={announcement.id} />
            <WithdrawButton />
          </form>
        )}
      </div>
    </article>
  );
}
