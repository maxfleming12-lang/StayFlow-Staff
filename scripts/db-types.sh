#!/usr/bin/env bash
#
# Regenerate src/types/database.ts from the local database.
#
# Pass --linked to generate from the linked remote project instead.

set -euo pipefail
cd "$(dirname "$0")/.."

SOURCE="${1:---local}"
OUT=src/types/database.ts
TMP=$(mktemp)

npx supabase gen types typescript "$SOURCE" > "$TMP"

# The header is re-applied on every run; the generator overwrites the file
# wholesale, so without this the "do not edit" warning silently disappears.
{
  cat <<'HEADER'
/**
 * Database types for StayFlow Staff.
 *
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate after any migration change:
 *   npm run db:types            # from the local stack
 *   npm run db:types -- --linked  # from the linked remote project
 */

HEADER
  cat "$TMP"
} > "$OUT"

rm -f "$TMP"
echo "Wrote $OUT ($(wc -l < "$OUT" | tr -d ' ') lines)"
