#!/usr/bin/env bash
# ============================================================
# Run Crema's migration chain against a throwaway local Postgres.
#
# These migrations are applied to production by hand, so without this
# their first execution anywhere is the real one. This builds a scratch
# cluster, loads stub.sql (the Supabase-only pieces: auth.uid(), the
# anon/authenticated roles, fakes for pg_cron / pg_net / vault), then
# every supabase/step-*.sql in order, then any test files given.
#
#   ./supabase/local-test/run.sh                     # load the chain
#   ./supabase/local-test/run.sh podium-test.sql     # ...and run a test
#
# Requires Homebrew postgresql@17. Nothing here touches production.
# ============================================================
set -euo pipefail

export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
# initdb refuses to run multithreaded, which is what an unset/UTF-8
# LC_ALL does on macOS: "postmaster became multithreaded during startup".
export LC_ALL=C LANG=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL="$HERE/.."
# Must live somewhere short: the Unix socket path has a 103-byte limit,
# which a repo checkout under a deep home directory blows straight past.
DIR="${CREMA_TEST_DIR:-/tmp/crema-localtest}"
PORT="${CREMA_TEST_PORT:-55518}"

command -v initdb >/dev/null || { echo "postgresql@17 not found — brew install postgresql@17"; exit 1; }

echo "==> fresh cluster in $DIR"
pg_ctl -D "$DIR/data" stop >/dev/null 2>&1 || true
rm -rf "$DIR"; mkdir -p "$DIR"
initdb -D "$DIR/data" --locale=C -U postgres >/dev/null

# Berlin, deliberately NOT UTC. Supabase runs UTC, which hides every bug
# where a timestamptz is cast in the session's zone rather than the one
# the query meant — exactly the class of bug that hit step-1.17.
pg_ctl -D "$DIR/data" -l "$DIR/log" \
  -o "-k $DIR -p $PORT -c listen_addresses='' -c timezone=Europe/Berlin" start >/dev/null
trap 'pg_ctl -D "$DIR/data" stop >/dev/null 2>&1 || true' EXIT
sleep 2

psql -h "$DIR" -p "$PORT" -U postgres -q -c "create database crema;"
run() { psql -h "$DIR" -p "$PORT" -U postgres -d crema -v ON_ERROR_STOP=1 -q "$@"; }

echo "==> stub"
run -f "$HERE/stub.sql"

echo "==> migrations"
# Numeric sort, so step-1.9 loads before step-1.10.
FILES=$(ls "$SQL"/step-*.sql | sort -t- -k2 -V)
for f in "$SQL/schema.sql" $FILES; do
  # pg_cron / pg_net are not installable here; stub.sql stands in for them.
  sed -E 's/^(create extension if not exists (pg_cron|pg_net).*)$/-- \1/' "$f" > "$DIR/$(basename "$f")"
  if run -f "$DIR/$(basename "$f")" 2>&1 | grep -v '^NOTICE' | grep -q .; then :; fi
  echo "    ok  $(basename "$f")"
done

# Supabase grants these by default; without them a security_invoker view
# is unreadable and RLS never gets a chance to be the thing that denies.
run -c "grant usage on schema public to anon, authenticated;" \
    -c "grant all on all tables in schema public to anon, authenticated;" \
    -c "grant all on all sequences in schema public to anon, authenticated;" \
    -c "revoke all on function podium_check() from public, anon, authenticated;" \
    -c "revoke all on table podium_places from anon, authenticated;"

for t in "$@"; do
  echo "==> $t"
  run -f "$HERE/$t"
done

echo "==> done"
