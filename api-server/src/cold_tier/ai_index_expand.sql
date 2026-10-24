-- Retired index payloads remain private recovery data, never retrieval evidence.
-- The migration runner executes this whole file in one locked transaction.
CREATE TABLE IF NOT EXISTS lumiere_platform.ai_legacy_index_payload (
    organization_id NUMERIC(20,0) NOT NULL,
    source_table TEXT NOT NULL CHECK (source_table IN ('document', 'search_embedding')),
    source_id NUMERIC(20,0) NOT NULL,
    company_id NUMERIC(20,0),
    payload JSONB NOT NULL,
    PRIMARY KEY (organization_id, source_table, source_id)
);
ALTER TABLE search_embedding ADD COLUMN expected_fingerprint TEXT NOT NULL DEFAULT '';
ALTER TABLE search_embedding ADD COLUMN index_generation TEXT NOT NULL DEFAULT 'legacy-unverified';
