-- ===========================================================================
-- 010_rollback.sql
--
-- Reverts 010_narrative_vector_index.sql and nothing else.
--
-- Drops only the index this feature adds. No table, no column, no row is
-- touched, so embeddings survive. After running this, vector search still
-- returns correct results, just via an exact KNN scan instead of the ANN index.
-- ===========================================================================

DROP INDEX IF EXISTS idx_nar_embedding;