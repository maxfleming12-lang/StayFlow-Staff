#!/usr/bin/env bash
#
# Reset the local database and run the Row Level Security test suite.
#
# Requires Docker to be running. The Supabase CLI is a devDependency, so no
# global install is needed — npm resolves it from node_modules/.bin.

set -euo pipefail

cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop, then try again." >&2
  exit 1
fi

echo "Resetting local database and applying migrations…"
npx supabase db reset

# The container name is derived from the project directory, so read it back
# rather than hardcoding it — the folder can be renamed or cloned elsewhere.
CONTAINER=$(docker ps --filter "name=supabase_db_" --format '{{.Names}}' | head -n 1)

if [ -z "$CONTAINER" ]; then
  echo "No Supabase database container is running. Try: npx supabase start" >&2
  exit 1
fi

echo "Running RLS test suite against $CONTAINER…"
docker exec -i "$CONTAINER" psql -U postgres -d postgres -q \
  < supabase/tests/rls_test.sql
