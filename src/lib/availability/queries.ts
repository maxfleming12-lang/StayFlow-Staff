import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { type AvailabilityRow, sortRules } from "./rules";

/** The availability_status enum, from the generated schema types. */
export type AvailabilityStatus =
  Database["public"]["Enums"]["availability_status"];

const STATUSES: AvailabilityStatus[] = ["pending", "approved", "declined"];

/** Narrow an untrusted URL parameter to a real status, or undefined. */
export function parseAvailabilityStatus(
  value: unknown,
): AvailabilityStatus | undefined {
  return STATUSES.find((s) => s === value);
}

export interface AvailabilityRecord extends AvailabilityRow {
  userId: string;
  staffName: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

const SELECT = `id, user_id, day_of_week, specific_date, start_time, end_time,
  is_available, note, status, review_note, reviewed_at, created_at,
  profiles!staff_availability_profile_fk ( preferred_name, legal_first_name, legal_last_name )`;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return (value as Record<string, unknown>) ?? null;
}

function map(row: Record<string, unknown>): AvailabilityRecord {
  const profile = asRecord(row.profiles);
  const preferred = (profile?.preferred_name as string | null)?.trim();
  const first = String(profile?.legal_first_name ?? "");
  const last = String(profile?.legal_last_name ?? "");

  return {
    id: String(row.id),
    userId: String(row.user_id),
    staffName:
      preferred && preferred.length > 0
        ? preferred
        : `${first} ${last}`.trim() || "Unknown",
    dayOfWeek: row.day_of_week != null ? Number(row.day_of_week) : null,
    specificDate: (row.specific_date as string | null) ?? null,
    startTime: (row.start_time as string | null) ?? null,
    endTime: (row.end_time as string | null) ?? null,
    isAvailable: Boolean(row.is_available),
    note: (row.note as string | null) ?? null,
    status: String(row.status),
    reviewNote: (row.review_note as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

/** The signed-in staff member's own availability rules. */
export async function getMyAvailability(): Promise<AvailabilityRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_availability")
    .select(SELECT)
    .is("archived_at", null);

  if (error) {
    throw new Error(`Could not load your availability: ${error.message}`);
  }
  return sortRules((data ?? []).map(map));
}

/**
 * Availability submissions visible to management.
 *
 * RLS scopes this to staff at the caller's properties, so a Coastal-only
 * manager never sees a Holiday Lodge submission.
 */
export async function getAvailabilityForReview(
  status?: AvailabilityStatus,
): Promise<AvailabilityRecord[]> {
  const supabase = await createClient();

  let query = supabase
    .from("staff_availability")
    .select(SELECT)
    .is("archived_at", null)
    .order("created_at", { ascending: true });

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Could not load availability: ${error.message}`);
  }
  return (data ?? []).map(map);
}
