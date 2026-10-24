ALTER TABLE document DROP COLUMN IF EXISTS index_content;
ALTER TABLE search_embedding DROP COLUMN IF EXISTS text;
ALTER TABLE search_embedding DROP COLUMN IF EXISTS embedding;
ALTER TABLE search_embedding DROP COLUMN IF EXISTS embedding_hash;
