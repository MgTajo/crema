#!/usr/bin/env bash
# ============================================================
# Turn a production schema dump into the Supabase CLI's baseline
# migration.
#
#   pg_dump "$(cat ~/.crema-db-url)" --schema-only --schema=public \
#     --no-owner | ./supabase/make-baseline.sh
#
# Read stdin, write supabase/migrations/<version>_baseline.sql.
#
# WHY A BASELINE AND NOT A REPLAY
# STRATEGY.md §1.3 wanted the 26 step-*.sql files converted into a CLI
# migration chain in dependency order. That assumes the repo chain equals
# production, which was Q1 — open since the project began. Dumping
# production instead makes the question moot: the dump IS production, by
# construction. The step files stay where they are, as history.
#
# WHAT COMES OUT, AND WHAT IS TAKEN OFF
#   - public only. `auth` belongs to Supabase and already exists on any
#     project; recreating it is how you break sign-in.
#   - no `\restrict` / `\unrestrict`. Postgres 17.6 dumps carry these psql
#     meta-commands; `supabase db push` sends SQL to the server directly
#     and would report a syntax error on the first one.
#   - no CREATE SCHEMA public, no ALTER SCHEMA ... OWNER, no
#     CREATE EXTENSION. Supabase owns all three, and the postgres role on
#     a hosted project is not a superuser.
#   - `create ... if not exists` is NOT synthesised. The baseline is
#     never meant to run against production — production already has this
#     schema. It runs against a NEW database: staging, or a local check.
#
# ⚠️ Reading production is all the dump does. Nothing here writes.
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$HERE/migrations"
# Regenerating replaces the baseline; it never adds a second one beside
# it. Two baselines is a migration chain that forks, and the CLI would
# apply both.
EXISTING="$(ls "$OUT_DIR"/*_baseline.sql 2>/dev/null | head -1 || true)"
if [ -n "${BASELINE_VERSION:-}" ]; then
  VERSION="$BASELINE_VERSION"
elif [ -n "$EXISTING" ]; then
  VERSION="$(basename "$EXISTING" | cut -d_ -f1)"
  echo "reusing the existing version $VERSION"
else
  VERSION="$(date -u +%Y%m%d%H%M%S)"
fi
OUT="$OUT_DIR/${VERSION}_baseline.sql"

mkdir -p "$OUT_DIR"
TMP="$(mktemp -t crema-baseline)"
trap 'rm -f "$TMP"' EXIT
cat > "$TMP"

[ -s "$TMP" ] || { echo "make-baseline: nothing on stdin" >&2; exit 1; }
grep -q '^CREATE TABLE public\.' "$TMP" || {
  echo "make-baseline: no public tables in that dump — wrong --schema?" >&2; exit 1; }

# The step files carry ~60 revoke/grant statements — podium_check(),
# user_points(), challenge_check() and the rest are deliberately not
# executable by anon. `pg_dump --no-privileges` strips every one of them,
# and a baseline built from such a dump silently builds a staging
# database where anon can call them. That is a security difference, not a
# formatting one, and it is invisible in the output. Refuse instead.
#
# ~/crema-backups/daily-dump.sh passes --no-privileges on purpose (it is
# a restore, not a baseline). Do not pipe that dump into this.
if ! grep -qE '^(REVOKE|GRANT) ' "$TMP"; then
  echo "make-baseline: that dump has no GRANT/REVOKE statements." >&2
  echo "  It was taken with --no-privileges. A baseline built from it would" >&2
  echo "  hand anon every function the step files revoke. Re-dump without it:" >&2
  echo >&2
  echo '    pg_dump "$(cat ~/.crema-db-url)" --schema-only --schema=public --no-owner' >&2
  exit 1
fi

python3 - "$TMP" "$OUT" "$VERSION" <<'PY'
import re, sys, io, datetime

src_path, out_path, version = sys.argv[1], sys.argv[2], sys.argv[3]
src = io.open(src_path, encoding='utf-8').read()

# pg_dump precedes every object with:
#   -- Name: <name>; Type: <TYPE>; Schema: <schema>; Owner: <owner>
# Split on those and keep the ones in public. Everything before the first
# header is the preamble, which we replace wholesale.
blocks = re.split(r'(?m)^(?=-- Name: )', src)
kept, dropped = [], {}

# DEFAULT ACL is Supabase's own: `alter default privileges for role
# supabase_admin ...`. Only a superuser can set those and the hosted
# postgres role is not one, so a baseline carrying them fails on a real
# project as surely as it does locally. Every Supabase database already
# has them.
DROP_TYPES = {'SCHEMA', 'EXTENSION', 'COMMENT', 'DEFAULT ACL'}

for b in blocks[1:]:
    head = b.split('\n', 1)[0]
    m = re.search(r'-- Name: (.*?); Type: (.*?); Schema: (.*?);', head)
    if not m:
        continue
    name, typ, schema = m.group(1), m.group(2), m.group(3)
    if schema != 'public' or typ in DROP_TYPES:
        dropped[typ] = dropped.get(typ, 0) + 1
        continue
    kept.append(b)

# ---- the thing a plain dump gets wrong on Supabase ----
# pg_dump writes its ACL section against POSTGRES's defaults: it emits
# "REVOKE ALL ... FROM PUBLIC" and then the grants somebody actually
# holds. Supabase's defaults are not Postgres's — `alter default
# privileges ... grant execute on functions to anon, authenticated` means
# every function is handed to anon the moment it is created.
#
# So on a real Supabase project the sequence is: the baseline creates
# challenge_check(), anon gets EXECUTE by default, and the dump's ACL
# section never revokes it because in production anon never had it. The
# staging database ends up MORE permissive than production, object by
# object, silently, for every one of the ~60 revokes the step files
# perform.
#
# Wiping the two roles clean immediately before the ACL section fixes it:
# anything production actually grants them is restored by the GRANT
# statements that follow, and anything it does not stays revoked.
RESET = """--
-- Name: RESET anon/authenticated; Type: ACL; Schema: public; Owner: -
--

-- See supabase/make-baseline.sh. Supabase grants these roles everything
-- in `public` at creation time, and a pg_dump ACL section is written
-- against Postgres's defaults, so it never takes them away again. Strip
-- them here; every GRANT below puts back exactly what production has.
revoke all on all tables    in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
revoke all on all functions in schema public from anon, authenticated, service_role;

"""

# Insert it before the first ACL block, which is after every CREATE.
for i, b in enumerate(kept):
    if re.search(r'-- Name: .*; Type: ACL;', b.split('\n')[0]):
        kept.insert(i, RESET)
        break
else:
    raise SystemExit('make-baseline: that dump has no ACL section at all — '
                     'it was taken with --no-privileges after all')

body = ''.join(kept)

# psql meta-commands. Postgres 17.6+ wraps dumps in \restrict/\unrestrict;
# `supabase db push` speaks to the server, not through psql, and stops on
# the first backslash.
body = re.sub(r'(?m)^\\(un)?restrict.*$\n?', '', body)

# Ownership and schema-level statements Supabase does not let us make.
body = re.sub(r'(?m)^ALTER (TABLE|FUNCTION|VIEW|SEQUENCE|TYPE|SCHEMA)\b.*OWNER TO .*;\n?', '', body)
body = re.sub(r'(?m)^CREATE SCHEMA .*;\n?', '', body)
body = re.sub(r'(?m)^CREATE EXTENSION .*;\n?', '', body)
body = re.sub(r'(?m)^COMMENT ON EXTENSION .*;\n?', '', body)
body = re.sub(r'\n{3,}', '\n\n', body)

header = f"""-- ============================================================
-- Crema — baseline. Generated by supabase/make-baseline.sh; do not edit.
--
-- This is the `public` schema of the PRODUCTION database, dumped and
-- turned into the first Supabase CLI migration. Everything from here
-- forward is a new file in this directory, applied by the release
-- workflow before the site deploys.
--
-- The 26 step-*.sql files one directory up stay where they are. They are
-- the history of how production got here; this file is where it got to.
-- Whether the two agree was Q1, and dumping rather than replaying is
-- what makes the question stop mattering.
--
-- ⚠️ NEVER RUN THIS AGAINST PRODUCTION. Production already is this.
--    It is marked applied there, not executed:
--
--      supabase migration repair --status applied {version} --linked
--
--    It runs, in full, against a NEW database: staging, or the local
--    check in local-test/baseline-check.sh.
--
-- Generated {datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}
-- ============================================================

set statement_timeout = 0;
set lock_timeout = 0;
set client_encoding = 'UTF8';
set standard_conforming_strings = on;
set check_function_bodies = false;
set xmloption = content;
set client_min_messages = warning;
set row_security = off;
select pg_catalog.set_config('search_path', '', false);

"""

io.open(out_path, 'w', encoding='utf-8').write(header + body.lstrip('\n'))

counts = {}
for pat, label in [(r'^CREATE TABLE ', 'tables'), (r'^CREATE FUNCTION ', 'functions'),
                   (r'^CREATE VIEW ', 'views'), (r'^CREATE POLICY ', 'policies'),
                   (r'^CREATE TRIGGER ', 'triggers'), (r'^CREATE (UNIQUE )?INDEX ', 'indexes'),
                   (r'^GRANT ', 'grants')]:
    counts[label] = len(re.findall(pat, body, re.M))
print('baseline:', out_path)
print('  ' + ', '.join(f'{v} {k}' for k, v in counts.items()))
if dropped:
    print('  dropped (not ours to create): ' + ', '.join(f'{v} {k}' for k, v in sorted(dropped.items())))
PY
