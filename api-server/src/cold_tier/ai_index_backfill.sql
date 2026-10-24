INSERT INTO lumiere_platform.ai_legacy_index_payload
    (organization_id, source_table, source_id, company_id, payload)
SELECT organization_id, 'document', id, company_id,
    jsonb_build_object('index_content', index_content)
FROM document WHERE index_content IS NOT NULL;
INSERT INTO lumiere_platform.ai_legacy_index_payload
    (organization_id, source_table, source_id, company_id, payload)
SELECT organization_id, 'search_embedding', id, company_id,
    jsonb_build_object('text', text, 'embedding', embedding, 'embedding_hash', embedding_hash)
FROM search_embedding;
-- No legacy vector is certified by this schema migration. Its source/version,
-- access, fingerprint and generation must be verified by the canonical worker.
UPDATE search_embedding SET sync_status = 'failed',
    sync_error = 'legacy index requires canonical passage reconciliation';
