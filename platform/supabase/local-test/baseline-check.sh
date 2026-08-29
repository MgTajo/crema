#!/usr/bin/env bash
# ============================================================
# Does the baseline actually build Crema's database?
#
#   ./supabase/local-test/baseline-check.sh          (from platform/)
#
# supabase/migrations/*_baseline.sql is a dump of production, so it is
# production by construction — but only if it still LOADS. This applies
# it to an empty database and compares the result, object by object,
# against what the 26 step-*.sql files build. Two schemas, two roads,
# one destination.
#
# This is the Docker-free stand-in for `supabase db diff`. The CLI's
# version needs a shadow database in a container, and this machine has
# no Docker on purpose — which is also why local-test/run.sh is built on
# Homebrew Postgres.
#
# Exit 1 if the baseline fails to load, or if either side has an object
# the other does not. A function whose BODY differs is reported and does
# not fail the run: production being one edit behind the repo is a fact
# about production, not about this file.
#
# CREMA_TEST_HOST points it at a Postgres somebody else started, exactly
# as run.sh does. CI uses that.
# ============================================================
set -euo pipefail

export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
export LC_ALL=C LANG=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL="$HERE/.."
DIR="${CREMA_TEST_DIR:-/tmp/crema-baseline-check}"
HOST="${CREMA_TEST_HOST:-}"
DBUSER="${CREMA_TEST_USER:-postgres}"

BASELINE=$(ls "$SQL"/migrations/*_baseline.sql 2>/dev/null | head -1 || true)
[ -n "$BASELINE" ] || { echo "no supabase/migrations/*_baseline.sql — run make-baseline.sh first"; exit 1; }
echo "==> baseline: $(basename "$BASELINE")"

if [ -n "$HOST" ]; then
  PORT="${CREMA_TEST_PORT:-5432}"
  export PGTZ=Europe/Berlin
  CONN=(-h "$HOST" -p "$PORT" -U "$DBUSER")
  for _ in $(seq 1 60); do pg_isready "${CONN[@]}" >/dev/null 2>&1 && break; sleep 1; done
  pg_isready "${CONN[@]}" >/dev/null || { echo "no Postgres at $HOST:$PORT"; exit 1; }
  mkdir -p "$DIR"
else
  PORT="${CREMA_TEST_PORT:-55522}"
  command -v initdb >/dev/null || { echo "postgresql@17 not found — brew install postgresql@17"; exit 1; }
  pg_ctl -D "$DIR/data" stop >/dev/null 2>&1 || true
  rm -rf "$DIR"; mkdir -p "$DIR"
  initdb -D "$DIR/data" --locale=C -U "$DBUSER" >/dev/null
  pg_ctl -D "$DIR/data" -l "$DIR/log" \
    -o "-k $DIR -p $PORT -c listen_addresses='' -c timezone=Europe/Berlin" start >/dev/null
  trap 'pg_ctl -D "$DIR/data" stop >/dev/null 2>&1 || true' EXIT
  sleep 2
  CONN=(-h "$DIR" -p "$PORT" -U "$DBUSER")
fi

admin() { psql "${CONN[@]}" -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
in_db() { local d="$1"; shift; psql "${CONN[@]}" -d "$d" -v ON_ERROR_STOP=1 -q "$@"; }

# ---------- 1. the chain, for comparison ----------
echo "==> loading the step chain"
admin -c "drop database if exists crema_chain;" -c "create database crema_chain;"
in_db crema_chain -f "$HERE/stub.sql" > "$DIR/.out" 2>&1
for f in "$SQL/schema.sql" $(ls "$SQL"/step-*.sql | sort -t- -k2 -V); do
  sed -E 's/^(create extension if not exists (pg_cron|pg_net).*)$/-- \1/' "$f" > "$DIR/$(basename "$f")"
  in_db crema_chain -f "$DIR/$(basename "$f")" > "$DIR/.out" 2>&1 \
    || { grep -v '^NOTICE' "$DIR/.out" >&2; echo "chain FAILED at $(basename "$f")" >&2; exit 1; }
done
for f in $(ls "$SQL"/migrations/*.sql 2>/dev/null | grep -v '_baseline\.sql$' | sort || true); do
  in_db crema_chain -f "$f" > "$DIR/.out" 2>&1 \
    || { grep -v '^NOTICE' "$DIR/.out" >&2; echo "chain FAILED on $(basename "$f")" >&2; exit 1; }
done

# ---------- 2. the baseline, on its own ----------
echo "==> loading the baseline into an empty database"
admin -c "drop database if exists crema_baseline;" -c "create database crema_baseline;"
in_db crema_baseline -f "$HERE/stub.sql" > "$DIR/.out" 2>&1
# The baseline is a pg_dump of production, where pg_cron / pg_net / vault
# are real. stub.sql stands in, same as for the chain.
# stub.sql has already put Supabase's default privileges in place, so
# this database is shaped like a real staging project: anon is handed
# every new object at creation time. That is the condition the baseline
# has to survive, and the one a naive dump does not.
if ! in_db crema_baseline -f "$BASELINE" > "$DIR/.baseline.out" 2>&1; then
  echo "the baseline does not load:" >&2
  grep -v '^NOTICE' "$DIR/.baseline.out" | head -20 >&2
  exit 1
fi
echo "    ok  it loads"

# Both sides have to end at the same point in the history. The chain got
# the follow-on migrations from run.sh's loop; the baseline needs them
# here, or every comparison below reports the newest migration as drift.
for f in $(ls "$SQL"/migrations/*.sql 2>/dev/null | grep -v '_baseline\.sql$' | sort || true); do
  in_db crema_baseline -f "$f" > "$DIR/.out" 2>&1 \
    || { grep -v '^NOTICE' "$DIR/.out" >&2; echo "  FAILED on $(basename "$f")" >&2; exit 1; }
  echo "    ok  $(basename "$f")"
done

# ---------- 3. compare the two, object by object ----------
for db in crema_chain crema_baseline; do
  pg_dump "${CONN[@]}" -d "$db" --schema-only --schema=public --no-owner --no-privileges \
    > "$DIR/$db.sql"
done

python3 - "$DIR/crema_chain.sql" "$DIR/crema_baseline.sql" <<'PY'
import re, sys, io, difflib

def objects(p):
    out = {}
    for b in re.split(r'(?m)^(?=-- Name: )', io.open(p, encoding='utf-8').read())[1:]:
        head = b.split('\n', 1)[0]
        key = re.sub(r'; Owner:.*', '', head)
        body = b.split('\n', 1)[1] if '\n' in b else ''
        body = re.sub(r'(?m)^--.*$', '', body)
        body = re.sub(r'(?m)^\\(un)?restrict.*$', '', body)
        body = re.sub(r'\n\s*\n+', '\n', body).strip()
        out[key] = body
    return out

chain, base = objects(sys.argv[1]), objects(sys.argv[2])

# Supabase's own automatic-RLS helper. It lives in `public` on a hosted
# project and is created by the platform, not by any migration, so a dump
# of production carries it and the step chain never will.
ALLOWED_ONLY_IN_BASELINE = {'-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public'}

# Differences we have looked at and understand. Anything NOT in here
# fails the run — that is the whole value of the list. Each entry says
# what makes it go away, because none of them should be permanent.
KNOWN = {
  '-- Name: posts; Type: TABLE; Schema: public':
    'cosmetic: Postgres reprints the posts_image_keys_are_keys CHECK with '
    'one fewer redundant paren pair. Same predicate. Nothing to fix.',
  '-- Name: push_config(text); Type: FUNCTION; Schema: public':
    'production is behind the repo: step-1.16.sql was amended after it was '
    'run (commit bae9443), and the btrim of Vault secrets never reached '
    'production. Re-run those two CREATE OR REPLACE statements, regenerate '
    'the baseline, and delete this entry.',
  '-- Name: push_send(jsonb); Type: FUNCTION; Schema: public':
    'same commit, same cause: the "push_secret unset" guard is in the repo '
    'and not in production. Same fix, same deletion.',
}

missing = sorted(set(chain) - set(base))
extra = sorted(set(base) - set(chain) - ALLOWED_ONLY_IN_BASELINE)
differ = sorted(k for k in set(chain) & set(base) if chain[k] != base[k])
known = [k for k in differ if k in KNOWN]
unknown = [k for k in differ if k not in KNOWN]

print(f"==> {len(set(chain) & set(base))} objects on both sides")
bad = False
if missing:
    bad = True
    print(f"\nIn the step chain but NOT in the baseline ({len(missing)}):")
    for k in missing: print("   ", k)
if extra:
    bad = True
    print(f"\nIn the baseline but NOT in the step chain ({len(extra)}):")
    for k in extra: print("   ", k)
if known:
    print(f"\n{len(known)} known difference(s), each with a reason:")
    for k in known:
        print(f"\n    {k.replace('-- Name: ','')}")
        print(f"      {KNOWN[k]}")
if unknown:
    bad = True
    print(f"\n{len(unknown)} UNEXPLAINED difference(s) — production is not what the repo says:")
    for k in unknown:
        print("\n   ", k)
        for line in list(difflib.unified_diff(
                chain[k].split('\n'), base[k].split('\n'),
                'step-chain', 'production-baseline', lineterm='', n=0))[:20]:
            print("    " + line)
if not bad:
    print("\nOK — the baseline builds the same database the chain does.")
sys.exit(1 if bad else 0)
PY

# ---------- 4. who may call what ----------
# The object comparison above cannot see this: pg_dump --no-privileges
# strips every grant, and the step files carry about sixty of them.
# podium_check(), user_points() and challenge_check() are revoked from
# anon on purpose, and a baseline that lost those revokes would build a
# staging database that hands them over -- silently, and identically
# shaped in every other respect.
# rls_auto_enable() is Supabase's own and exists only on the production
# side, so its two lines are dropped rather than reported as drift. It is
# the same object the structural comparison above allows through.
strip_platform() { grep -v '^fn|rls_auto_enable()' | sort; }
psql "${CONN[@]}" -d crema_chain    -tAq -f "$HERE/privileges.sql" | strip_platform > "$DIR/chain.privs"
psql "${CONN[@]}" -d crema_baseline -tAq -f "$HERE/privileges.sql" | strip_platform > "$DIR/baseline.privs"

if diff -u "$DIR/chain.privs" "$DIR/baseline.privs" > "$DIR/privs.diff"; then
  echo "==> privileges for anon and authenticated: identical ($(wc -l < "$DIR/chain.privs" | tr -d ' ') checks)"
else
  echo
  echo "PRIVILEGES DIFFER between the step chain and the baseline."
  echo "  -  what the step chain grants"
  echo "  +  what the baseline grants"
  echo "If the + side is the more permissive one, the baseline was dumped"
  echo "with --no-privileges and has to be regenerated without it."
  echo
  sed -n '3,40p' "$DIR/privs.diff"
  exit 1
fi
