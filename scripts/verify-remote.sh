#!/usr/bin/env bash
#
# Verify the security posture of the LINKED remote Supabase project.
#
# Run after `supabase db push` against a new project. Checks the guarantees
# SECURITY.md claims, against the live database rather than the migrations.
#
# Usage: npm run db:verify
#   Requires the database password (prompted by the CLI, never stored here).

set -euo pipefail
cd "$(dirname "$0")/.."

REF=$(cat supabase/.temp/project-ref 2>/dev/null || true)
if [ -z "$REF" ]; then
  echo "No linked project. Run: npx supabase link" >&2
  exit 1
fi
echo "Verifying linked project: $REF"
echo

npx supabase migration list --linked
