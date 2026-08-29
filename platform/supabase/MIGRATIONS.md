# Migrations, from here forward

**Step 1.3 of [the infrastructure plan](../../../brain/13-infrastructure-plan.md).**
`supabase/README.md` is the historical runbook for the 26 hand-run `step-*.sql` files.
This is what happens instead, from 2026-08-29.

---

## What changed

The 26 `step-*.sql` files stay exactly where they are. They are how production got
here and nothing rewrites them. What they stop being is the *mechanism*.

`supabase/migrations/<version>_baseline.sql` is the `public` schema of the
production database, dumped. Everything from here forward is a new file in that
directory, applied by `.github/workflows/release.yml` before the site deploys.

STRATEGY.md §1.3 wanted the step files converted into a CLI chain in dependency
order. That assumes the repo chain equals production — **Q1**, open since the
project began. Dumping production instead makes the question stop mattering: the
dump *is* production.

> As it turns out, the chain and production agree on 348 of 349 objects, and the
> one exception is Supabase's own `rls_auto_enable()`. Two function *bodies*
> differ, and both are production being one commit behind the repo. See
> `local-test/baseline-check.sh`, which is what measured that.

---

## Adding a migration

```bash
cd platform
supabase migration new what_it_does
```

Write it, then prove it before it goes anywhere near production:

```bash
./supabase/local-test/run.sh your-test.sql
```

Commit both. The release workflow applies it on the next tag — migrations first,
site second, and a failed migration means the site is not deployed at all.

⚠️ **Never paste it into the SQL editor.** That is what this replaces. A migration
applied by hand is a migration the CLI does not know about, and the next
`db push` will try to apply it again.

---

## Regenerating the baseline

Only needed when production is changed outside the CLI — which, after this, it
should not be.

```bash
cd platform
pg_dump "$(cat ~/.crema-db-url)" --schema-only --schema=public --no-owner \
  | ./supabase/make-baseline.sh
./supabase/local-test/baseline-check.sh
```

The first command **reads production**. It writes nothing. The second builds two
throwaway local databases and compares them; it never touches production at all.

Regenerating replaces the baseline in place — the version in the filename is
reused deliberately, because two baselines is a chain that forks.

---

## The one-time setup, on a database that already has the schema

Production already *is* the baseline, so the baseline must never run there. It
gets recorded as applied instead:

```bash
cd platform
supabase link --project-ref diabtvahplwoipvrprvb
supabase migration repair --status applied <version> --linked
supabase migration list --linked
```

`migration repair` writes one row to `supabase_migrations.schema_migrations`.
It does not run the file, and it does not touch a table of yours. Do it before
the next tag, or `db push` will try to create tables that already exist — the
push is transactional, so it fails rather than damaging anything, but it fails.

A **new** database — staging — is the opposite case. There the baseline is
supposed to run:

```bash
supabase link --project-ref <staging-ref>
supabase db push --linked
```

---

## Two GitHub secrets

`release.yml` needs both, and says so by name if either is missing:

| Secret | Where it comes from |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase dashboard → Account → Access Tokens |
| `SUPABASE_DB_PASSWORD` | the production database password |

⚠️ The standing rule from the infrastructure plan is unchanged and this workflow
does not replace it: **take a fresh dump immediately before every migration
against production.** Put a required reviewer on the `production` environment in
the GitHub UI and the approval click becomes the place you do it.
`~/crema-backups/daily-dump.sh`, about twelve seconds.
