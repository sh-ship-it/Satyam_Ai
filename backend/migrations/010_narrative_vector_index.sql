-- ===========================================================================
-- 010_narrative_vector_index.sql
--
-- Ensures the approximate-nearest-neighbour index on narratives.embedding.
--
-- Additive and idempotent. No DROP, no ALTER of an existing object, no data
-- touched. Safe to run repeatedly.
--
-- WHY THIS EXISTS
-- ---------------
-- 001_init.sql created this index on the v1 schema. 002_schema_v2.sql drops and
-- recreates the narratives table and never recreates it, so on any database
-- built from 002 onwards the index is absent.
--
-- The index is NOT an optimisation, it is required. apply_rls_context sets
-- statement_timeout to 5 s, and without an ANN index `ORDER BY embedding <=> $1`
-- is an exact KNN scan over every embedded row, which exceeds that budget and
-- makes the whole vector arm report itself unavailable.
--
-- seed/embed_narratives.py also creates this index, with this same name, after
-- it finishes populating embeddings. IF NOT EXISTS makes running both harmless.
--
-- OPERATOR CLASS IS DETECTED, NOT ASSUMED
-- ---------------------------------------
-- The two deployments store different types on purpose: local Postgres uses
-- fp32 `vector(1024)`, while the Neon free tier uses fp16 `halfvec(1024)`
-- because fp32 vectors plus this index do not fit in a 512 MB project. An hnsw
-- index must use the operator class matching the column type, so a hardcoded
-- `vector_cosine_ops` fails outright on a halfvec column. The column type is
-- therefore read from the catalogue and the operator class chosen from it.
--
-- OPERATIONAL NOTE ON ORDERING
-- ----------------------------
-- Prefer to populate embeddings FIRST and let the job build the index at the
-- end: building it while empty forces every UPDATE to maintain it, which is far
-- slower than one bulk build. Running this against an already-indexed database
-- costs nothing.
-- ===========================================================================

DO $$
DECLARE
    coltype text;
    ops     text;
BEGIN
    SELECT format_type(a.atttypid, a.atttypmod)
      INTO coltype
      FROM pg_attribute a
     WHERE a.attrelid = 'narratives'::regclass
       AND a.attname  = 'embedding'
       AND NOT a.attisdropped;

    IF coltype IS NULL THEN
        RAISE NOTICE '010: narratives.embedding not present, nothing to index';
        RETURN;
    END IF;

    ops := CASE
               WHEN coltype LIKE 'halfvec%' THEN 'halfvec_cosine_ops'
               ELSE 'vector_cosine_ops'
           END;

    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_nar_embedding '
        'ON narratives USING hnsw (embedding %s)', ops);

    RAISE NOTICE '010: idx_nar_embedding ensured for column % using %', coltype, ops;
END $$;