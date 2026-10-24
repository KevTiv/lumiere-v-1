-- A C3 projector can create the current relation shape before migration adoption.
-- Archive only legacy columns that exist; reject partial legacy vector shapes.
DO $backfill$
DECLARE legacy_columns integer;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'document'::regclass
               AND attname = 'index_content' AND NOT attisdropped) THEN
        EXECUTE $document$INSERT INTO lumiere_platform.ai_legacy_index_payload
    (organization_id, source_table, source_id, company_id, payload)
SELECT organization_id, 'document', id, company_id,
    jsonb_build_object('index_content', index_content)
FROM document WHERE index_content IS NOT NULL;
$document$;
    END IF;
    SELECT count(*) INTO legacy_columns FROM pg_attribute
      WHERE attrelid = 'search_embedding'::regclass AND NOT attisdropped
        AND attname IN ('text', 'embedding', 'embedding_hash');
    IF legacy_columns NOT IN (0, 3) THEN
        RAISE EXCEPTION 'partial legacy embedding payload shape';
    END IF;
    IF legacy_columns = 3 THEN
        EXECUTE $embedding$INSERT INTO lumiere_platform.ai_legacy_index_payload
    (organization_id, source_table, source_id, company_id, payload)
SELECT organization_id, 'search_embedding', id, company_id,
    jsonb_build_object('text', text, 'embedding', embedding, 'embedding_hash', embedding_hash)
FROM search_embedding;
$embedding$;
        -- No legacy vector is certified by schema adoption.
        UPDATE search_embedding SET sync_status = 'failed',
            sync_error = 'legacy index requires canonical passage reconciliation';
    END IF;
END
$backfill$;
