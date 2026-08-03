-- ============================================================
-- Crema — points for making coffee, not for using the app
--
-- Run after step-1.13.sql. Re-runnable.
--
-- The score now comes from five things, and nothing else:
--
--   log a coffee                        +10
--   a like on your pour                  +2
--   a comment on your pour               +3
--   a pour logged with an exact recipe   +5
--   a bean you have never logged before +15
--
-- What went, and why:
--
--   * Challenge entries (+25) and votes on them (+1). Challenges are
--     being reworked and are behind "Coming soon" in the app; a score
--     that keeps paying out for a feature nobody can reach is a score
--     that lies. Existing entries stop counting — the backfill at the
--     bottom takes those points back, which is the point of recomputing
--     from the rows rather than incrementing counters.
--
-- What arrived, and why those:
--
--   * Comments received, alongside likes received. Both are other people
--     reacting to your coffee; a comment takes more than a tap, so it is
--     worth more than a like. Your own comments on your own posts are
--     excluded, the same way self-likes are refused (step-1.10.sql) —
--     any score you can pay yourself is not a score.
--
--   * An exact recipe. "Exact" means dose AND yield: the two numbers
--     that make a pour something another person can actually repeat.
--     That is already what the app means by a recipe — the button reads
--     "Recipe · 18g in → 36g out" only when both are there
--     (recipeBtnLabel in src/ui/components.js).
--
--   * A new bean, counted once per distinct coffee, ever. It rewards
--     trying something new rather than re-logging the same bag, which is
--     what the bean passport on the profile is already about.
-- ============================================================

-- ---------- the score itself ----------
-- Still recomputed from the rows, never incremented, so a deleted post
-- (or an edit that removes a recipe) takes its points with it.
create or replace function user_points(uid uuid)
returns int language sql stable as $$
  select
      -- a coffee logged
      coalesce((select count(*) from posts where user_id = uid), 0) * 10

      -- likes other people put on your pours
    + coalesce((select count(*) from likes l
                  join posts p on p.id = l.post_id
                 where p.user_id = uid), 0) * 2

      -- comments other people left on your pours (never your own)
    + coalesce((select count(*) from comments c
                  join posts p on p.id = c.post_id
                 where p.user_id = uid
                   and c.user_id is distinct from p.user_id), 0) * 3

      -- pours you logged with a repeatable recipe: dose in, yield out
    + coalesce((select count(*) from posts
                 where user_id = uid
                   and coalesce(btrim(recipe->>'dose'),  '') <> ''
                   and coalesce(btrim(recipe->>'yield'), '') <> ''), 0) * 5

      -- distinct beans you have logged, counted once each
    + coalesce((select count(distinct lower(btrim(recipe->>'bean'))) from posts
                 where user_id = uid
                   and coalesce(btrim(recipe->>'bean'), '') <> ''), 0) * 15;
$$;

-- ---------- triggers ----------
-- recalc_score(), trg_score_owner() and trg_score_post_author() are
-- unchanged from step-1.9.sql; only which tables point at them moves.

-- Posts now fire on UPDATE too. They did not need to before, because a
-- post's contribution was just "it exists" — but a post carries its own
-- recipe and bean now, and editing one (step-1.12.sql) can add or remove
-- both. Without this an edit that fills in dose and yield would be worth
-- nothing until the next unrelated recalculation.
drop trigger if exists posts_score on posts;
create trigger posts_score after insert or update or delete on posts
  for each row execute function trg_score_owner();

-- Comments move the *post author's* score, not the commenter's.
drop trigger if exists comments_score on comments;
create trigger comments_score after insert or delete on comments
  for each row execute function trg_score_post_author();

-- Challenges no longer pay. The tables and their own triggers from
-- step-1.8.sql stay exactly as they are — this only stops them moving
-- the score, so nothing is lost if challenges come back.
drop trigger if exists entries_score     on challenge_entries;
drop trigger if exists entry_votes_score on entry_votes;

-- ---------- backfill ----------
-- Everyone's score is restated under the new rules in one pass. Scores
-- will move both ways: down for anyone who entered a challenge, up for
-- anyone who has been logging real recipes and new beans.
update profiles p
   set points = user_points(p.id),
       level  = level_for_points(user_points(p.id));

-- ---------- what to expect afterwards ----------
--   select handle, points, level from profiles order by points desc limit 10;
--   -- and the breakdown for one person, to check it against the app:
--   --   select count(*) filter (where true) as pours,
--   --          count(*) filter (where coalesce(btrim(recipe->>'dose'),'')  <> ''
--   --                             and coalesce(btrim(recipe->>'yield'),'') <> '') as exact_recipes,
--   --          count(distinct lower(btrim(recipe->>'bean')))
--   --            filter (where coalesce(btrim(recipe->>'bean'),'') <> '') as beans
--   --     from posts where user_id = '<uid>';
