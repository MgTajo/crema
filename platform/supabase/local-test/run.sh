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
#   ./supabase/local-test/run.sh *-test.sql          # ...or all of them
#
# Each test file gets its OWN database, copied from the loaded chain.
# They are not isolated otherwise: reaction-push-test.sql asserts on the
# exact number of rows in net.calls, which another test's fixtures had
# already added to. Sharing one database made the order of the arguments
# part of the result, which is not a property a test suite should have.
#
# Requires Homebrew postgresql@17. Nothing here touches production.
#
# CI runs this same file against a Postgres service container rather than
# building a cluster: set CREMA_TEST_HOST (and PORT / USER / PGPASSWORD).
# One file, so the thing the workflow proves is the thing you ran.
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
HOST="${CREMA_TEST_HOST:-}"
DBUSER="${CREMA_TEST_USER:-postgres}"

if [ -n "$HOST" ]; then
  PORT="${CREMA_TEST_PORT:-5432}"
  # Berlin, deliberately NOT UTC — same reason as below. On somebody
  # else's server the session GUC is the only handle we have, and PGTZ
  # sets it for every psql this script starts.
  export PGTZ=Europe/Berlin
  CONN=(-h "$HOST" -p "$PORT" -U "$DBUSER")
  echo "==> using the Postgres at $HOST:$PORT"
  for _ in $(seq 1 60); do
    pg_isready "${CONN[@]}" >/dev/null 2>&1 && break
    sleep 1
  done
  pg_isready "${CONN[@]}" >/dev/null || { echo "no Postgres at $HOST:$PORT"; exit 1; }
  mkdir -p "$DIR"
else
  PORT="${CREMA_TEST_PORT:-55518}"
  command -v initdb >/dev/null || { echo "postgresql@17 not found — brew install postgresql@17"; exit 1; }

  echo "==> fresh cluster in $DIR"
  pg_ctl -D "$DIR/data" stop >/dev/null 2>&1 || true
  rm -rf "$DIR"; mkdir -p "$DIR"
  initdb -D "$DIR/data" --locale=C -U "$DBUSER" >/dev/null

  # Berlin, deliberately NOT UTC. Supabase runs UTC, which hides every bug
  # where a timestamptz is cast in the session's zone rather than the one
  # the query meant — exactly the class of bug that hit step-1.17.
  pg_ctl -D "$DIR/data" -l "$DIR/log" \
    -o "-k $DIR -p $PORT -c listen_addresses='' -c timezone=Europe/Berlin" start >/dev/null
  trap 'pg_ctl -D "$DIR/data" stop >/dev/null 2>&1 || true' EXIT
  sleep 2
  CONN=(-h "$DIR" -p "$PORT" -U "$DBUSER")
fi

# psql against the maintenance database, for CREATE/DROP DATABASE only.
admin() { psql "${CONN[@]}" -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
# psql against a named database.
in_db() { local d="$1"; shift; psql "${CONN[@]}" -d "$d" -v ON_ERROR_STOP=1 -q "$@"; }
# psql against the database holding the loaded chain.
run() { in_db crema "$@"; }

admin -c "drop database if exists crema;" -c "create database crema;"

echo "==> stub"
run -f "$HERE/stub.sql"

echo "==> migrations"
# Numeric sort, so step-1.9 loads before step-1.10.
FILES=$(ls "$SQL"/step-*.sql | sort -t- -k2 -V)
for f in "$SQL/schema.sql" $FILES; do
  # pg_cron / pg_net are not installable here; stub.sql stands in for them.
  sed -E 's/^(create extension if not exists (pg_cron|pg_net).*)$/-- \1/' "$f" > "$DIR/$(basename "$f")"
  # A failed step has to fail the run. Until 2026-08-29 this line piped
  # psql into grep inside an `if`, which discards the exit status twice
  # over: a step that errored printed its error and then printed "ok",
  # and the script exited 0. That is precisely the step-1.28 class of
  # bug (0A000, rejected outright) this harness exists to catch.
  if ! run -f "$DIR/$(basename "$f")" > "$DIR/.load.out" 2>&1; then
    grep -v '^NOTICE' "$DIR/.load.out" >&2 || true
    echo "    FAILED  $(basename "$f")" >&2
    exit 1
  fi
  grep -v '^NOTICE' "$DIR/.load.out" || true
  echo "    ok  $(basename "$f")"
done

# Supabase grants these by default; without them a security_invoker view
# is unreadable and RLS never gets a chance to be the thing that denies.
run -c "grant usage on schema public to anon, authenticated;" \
    -c "grant all on all tables in schema public to anon, authenticated;" \
    -c "grant all on all sequences in schema public to anon, authenticated;" \
    -c "revoke all on function podium_check() from public, anon, authenticated;" \
    -c "revoke all on function podium_award_day(date) from public, anon, authenticated;" \
    -c "revoke all on function podium_award_recent() from public, anon, authenticated;" \
    -c "revoke all on table podium_places from anon, authenticated;" \
    -c "revoke all on table push_i18n from anon, authenticated;"

n=0
for t in "$@"; do
  n=$((n + 1))
  db="crema_t$n"
  admin -c "drop database if exists $db;" -c "create database $db template crema;"
  echo "==> $t"
  in_db "$db" -f "$HERE/$(basename "$t")"
done

echo "==> done"
