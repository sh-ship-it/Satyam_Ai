-- 012_local_bilingual_rag.sql
-- ---------------------------------------------------------------------------
-- LOCAL DATABASE ONLY. Refuses to run anywhere else (guard below).
-- Idempotent: safe to re-run after a re-seed.
--
-- Makes the lexical half of the hybrid retriever actually work, in English and
-- Kannada, under RLS, inside the 5 s statement_timeout that db/rls.py sets.
--
-- ── THREE MEASURED DEFECTS THIS ADDRESSES ─────────────────────────────────
--
-- 1. plainto_tsquery ANDs every term.
--    "find cases about thefts of two-wheelers near a market" became an
--    11-lexeme conjunction and matched 0 rows. Retrieval silently ran
--    vector-only; the logs showed `strategy=vector` on every narrative query.
--
-- 2. body_tsv is to_tsvector('simple', body) — no stemming.
--    Measured over the 100k English narratives: "thefts" 0 hits, "robberies" 0,
--    "murdered" 0, "vehicles" 0. The corpus says "theft"; the query said
--    "thefts"; 'simple' does not connect them.
--
-- 3. ts_rank has no IDF, so OR-ing the terms instead does not help.
--    OR matched 109,749 rows and the top-ranked ones were template boilerplate:
--    1 of the top 6 mentioned any distinctive term, and ts_rank_cd tied at
--    exactly 0.60000. These narratives are generated from a template, so
--    `investig`, `hrs`, `regist`, `fir`, `vide`, `district`, `limit` occur in
--    100% of documents, `case` in 94%, `report`/`complain` in 81%.
--
-- ── WHY NOT SIMPLY INDEX to_tsvector('english', body) ─────────────────────
-- Tried and rejected on measurement. A partial functional GIN index over that
-- expression works fine for the table owner (51 ms) but collapses to 8.5 s for
-- the app role, over the 5 s cap. The RLS policy on narratives is
--   EXISTS (SELECT 1 FROM cases c WHERE c.case_id = narratives.case_id
--                                  AND fn_scope_ok(...))
-- which acts as a security barrier, and `@@` is not leakproof, so the planner
-- cannot use the tsquery as an index condition through it. The plan degrades to
-- a filter that recomputes to_tsvector for all 100,000 English rows and runs the
-- policy subplan 100,000 times.
--
-- The stored body_tsv column has no such problem — it is a column, not an
-- expression, so the filter is cheap: 288-485 ms under RLS.
--
-- ── THE APPROACH ──────────────────────────────────────────────────────────
-- Keep matching the stored, unstemmed body_tsv, and move the intelligence into
-- precomputed vocabulary tables:
--
--   * document frequency per corpus token, so uninformative terms are dropped
--     before matching instead of being ranked afterwards;
--   * an English stem per token, so a query token can be expanded to the corpus
--     tokens that share its stem. This recovers stemming against an unstemmed
--     index: "thefts" -> stem "theft" -> corpus token "theft".
--
-- The retriever then builds  (theft) & (wheelers) & (market)  — informative
-- terms only, each expanded to its corpus variants — and relaxes by dropping the
-- commonest group if a round matches nothing. Measured at 379 ms under RLS.
--
-- Bilingual by construction: the vocabulary is keyed by language, so an English
-- query finds no Kannada tokens and a Kannada query finds no English ones. That
-- gives language routing for free, and Kannada gets identical treatment —
-- 'simple' is the correct configuration for Kannada anyway, since Postgres ships
-- no Kannada dictionary and there is nothing to stem.
--
-- CLOUD IS UNAFFECTED: this never runs there, no existing object is altered, and
-- rag.py probes for these tables and keeps its previous behaviour without them.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF current_database() <> 'satyam' THEN
        RAISE EXCEPTION
            'LOCAL-ONLY migration: refusing to run on database "%" as "%"',
            current_database(), current_user;
    END IF;
END $$;

-- An earlier revision of this work added a partial functional index over
-- to_tsvector('english', body). It is unusable under RLS (see above) and nothing
-- references it, so drop it rather than leave 16 MB of dead index behind.
DROP INDEX IF EXISTS idx_nar_fts_en;

DROP TABLE IF EXISTS narrative_lexeme_df;
CREATE TABLE narrative_lexeme_df (
    -- 'en' | 'kn' — the language whose corpus this token came from. Doubles as
    -- the routing key: query tokens only ever match their own language.
    lang   text    NOT NULL,
    lexeme text    NOT NULL,   -- token as body_tsv stores it (unstemmed)
    stem   text    NOT NULL,   -- English stem, or the token itself if unstemmable
    ndoc   integer NOT NULL,   -- documents containing the token
    PRIMARY KEY (lang, lexeme)
);

INSERT INTO narrative_lexeme_df (lang, lexeme, stem, ndoc)
SELECT 'en', word,
       coalesce((tsvector_to_array(to_tsvector('english', word)))[1], word),
       ndoc
FROM ts_stat('SELECT body_tsv FROM narratives WHERE language = ''en''');

INSERT INTO narrative_lexeme_df (lang, lexeme, stem, ndoc)
SELECT 'kn', word,
       coalesce((tsvector_to_array(to_tsvector('english', word)))[1], word),
       ndoc
FROM ts_stat('SELECT body_tsv FROM narratives WHERE language <> ''en''');

-- Lookup is always (lang, stem) to expand a query token to its variants.
CREATE INDEX idx_nar_lex_stem ON narrative_lexeme_df (lang, stem);

-- Corpus sizes, so the selectivity cut is a fraction rather than a magic number.
DROP TABLE IF EXISTS narrative_lexeme_corpus;
CREATE TABLE narrative_lexeme_corpus (
    lang  text PRIMARY KEY,
    ndocs integer NOT NULL
);
INSERT INTO narrative_lexeme_corpus (lang, ndocs)
SELECT 'en', count(*) FROM narratives WHERE language = 'en';
INSERT INTO narrative_lexeme_corpus (lang, ndocs)
SELECT 'kn', count(*) FROM narratives WHERE language <> 'en';

-- The app connects as the non-owner satyam_app. 008 sets default privileges, but
-- grant explicitly so this migration stands on its own.
GRANT SELECT ON narrative_lexeme_df, narrative_lexeme_corpus TO satyam_app;

ANALYZE narrative_lexeme_df;
ANALYZE narrative_lexeme_corpus;
