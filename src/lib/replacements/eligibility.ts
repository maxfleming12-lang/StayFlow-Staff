import { findConflicts, type CandidateShift, type ConflictContext } from "@/lib/roster/conflicts";

/**
 * Who may be offered a shift.
 *
 * Eligibility is deliberately split into two ideas:
 *
 *   * HARD rules exclude someone entirely — they cannot work that property,
 *     or they are the person trying to give the shift away.
 *   * SOFT rules keep them on the list but attach a warning. Someone already
 *     rostered elsewhere that day is usually the wrong choice, but on a
 *     Saturday when nobody else can cover, a manager may well ask them
 *     anyway. Removing them from the list silently would hide the only
 *     option available.
 */

export interface EligibleStaff {
  id: string;
  displayName: string;
  jobTitle: string | null;
  /** Property ids this person may work at. */
  propertyIds: string[];
  isActive: boolean;
}

export interface EligibilityResult {
  staff: EligibleStaff;
  /** Non-blocking reasons this person may be a poor fit. */
  warnings: string[];
}

/**
 * Rank the workforce for a shift being given away.
 *
 * Returns only those who pass the hard rules, each carrying any soft
 * warnings, sorted so unencumbered people appear first.
 */
export function findEligibleStaff(options: {
  shift: CandidateShift;
  /** The person giving the shift away, excluded from the result. */
  excludeUserId: string | null;
  workforce: EligibleStaff[];
  /** Conflict context per candidate, keyed by user id. */
  contextFor: (userId: string) => ConflictContext | null;
}): EligibilityResult[] {
  const results: EligibilityResult[] = [];

  for (const person of options.workforce) {
    // --- Hard rules -------------------------------------------------
    if (!person.isActive) continue;
    if (options.excludeUserId && person.id === options.excludeUserId) continue;
    if (!person.propertyIds.includes(options.shift.propertyId)) continue;

    // --- Soft rules -------------------------------------------------
    const warnings: string[] = [];
    const context = options.contextFor(person.id);

    if (context) {
      const conflicts = findConflicts(
        { ...options.shift, id: undefined, userId: person.id },
        context,
      );
      for (const conflict of conflicts) {
        warnings.push(conflict.message);
      }
    }

    results.push({ staff: person, warnings });
  }

  // Fewest warnings first, then alphabetically, so the obvious choices are
  // at the top of a list a manager reads on a phone.
  return results.sort((a, b) => {
    if (a.warnings.length !== b.warnings.length) {
      return a.warnings.length - b.warnings.length;
    }
    return a.staff.displayName.localeCompare(b.staff.displayName);
  });
}

/** Terminal states — a request in one of these needs no further action. */
const SETTLED = new Set(["approved", "rejected", "withdrawn"]);

export function isSettled(status: string): boolean {
  return SETTLED.has(status);
}

/**
 * Whether a status transition is allowed.
 *
 * Encoded explicitly rather than left implicit in the UI, so an unexpected
 * request cannot walk a replacement backwards — for example reopening an
 * approved swap after the roster has been rebuilt around it.
 */
const TRANSITIONS: Record<string, string[]> = {
  requested: ["offered", "rejected", "withdrawn"],
  offered: ["claimed", "rejected", "withdrawn"],
  claimed: ["approved", "rejected", "offered"],
  approved: [],
  rejected: [],
  withdrawn: [],
};

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** Human label for a replacement status. */
export const REPLACEMENT_STATUS_LABEL: Record<string, string> = {
  requested: "Awaiting manager",
  offered: "Offered to staff",
  claimed: "Claimed — needs approval",
  approved: "Approved",
  rejected: "Declined",
  withdrawn: "Withdrawn",
};
