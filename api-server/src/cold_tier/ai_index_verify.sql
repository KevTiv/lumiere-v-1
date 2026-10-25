DO $verify$
DECLARE mismatch boolean;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'document'::regclass
               AND attname = 'index_content' AND NOT attisdropped) THEN
        EXECUTE $document$SELECT EXISTS (
        SELECT 1 FROM document d WHERE d.index_content IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM lumiere_platform.ai_legacy_index_payload a
            WHERE a.organization_id = d.organization_id AND a.source_table = 'document'
              AND a.source_id = d.id AND a.company_id IS NOT DISTINCT FROM d.company_id
              AND a.payload = jsonb_build_object('index_content', d.index_content)
        )
    )$document$ INTO mismatch;
        IF mismatch THEN
            RAISE EXCEPTION 'canonical index migration archive verification failed';
        END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'search_embedding'::regclass
               AND attname = 'text' AND NOT attisdropped) THEN
        EXECUTE $embedding$SELECT EXISTS (
        SELECT 1 FROM search_embedding e WHERE NOT EXISTS (
            SELECT 1 FROM lumiere_platform.ai_legacy_index_payload a
            WHERE a.organization_id = e.organization_id AND a.source_table = 'search_embedding'
              AND a.source_id = e.id AND a.company_id IS NOT DISTINCT FROM e.company_id
              AND a.payload = jsonb_build_object('text', e.text, 'embedding', e.embedding,
                                                'embedding_hash', e.embedding_hash)
        )
    )$embedding$ INTO mismatch;
        IF mismatch THEN
            RAISE EXCEPTION 'canonical index migration archive verification failed';
        END IF;
    END IF;
END
$verify$;
