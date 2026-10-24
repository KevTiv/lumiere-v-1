#!/usr/bin/env bash
# Executes the shipped SQL against disposable local PostgreSQL data only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PGHOST="${PG_HOST:-${PGHOST:-/tmp}}"
export PGPORT="${PG_PORT:-${PGPORT:-5432}}"
export PGUSER="${PG_USER:-${PGUSER:-$(id -un)}}"
export PGPASSWORD="${PG_PASSWORD:-${PGPASSWORD:-}}"
case "$PGHOST" in 127.0.0.1|localhost|::1|/tmp|/var/run/postgresql) ;; *) echo "test requires local PostgreSQL" >&2; exit 1;; esac
TEST_DB="lumiere_ai_index_test_$$"
createdb "$TEST_DB"
trap 'dropdb --if-exists "$TEST_DB" >/dev/null' EXIT
export PGDATABASE="$TEST_DB"
fixture() {
  psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA lumiere_platform;
CREATE TABLE document (id NUMERIC(20,0), organization_id NUMERIC(20,0), company_id NUMERIC(20,0), index_content TEXT);
CREATE TABLE search_embedding (id NUMERIC(20,0), organization_id NUMERIC(20,0), company_id NUMERIC(20,0), text TEXT NOT NULL, embedding JSONB NOT NULL, embedding_hash TEXT, sync_status TEXT, sync_error TEXT);
INSERT INTO document VALUES (1, 9, 3, 'exact legacy text'), (2, 10, 4, 'foreign tenant text');
INSERT INTO search_embedding VALUES (3, 9, 3, 'passage', '[0.125,0.5]', 'exact-hash', 'synced', NULL), (4, 10, NULL, 'foreign passage', '[]', NULL, 'pending', NULL);
SQL
}
fixture
MIGRATIONS="$ROOT/api-server/src/cold_tier"
# Prove an archive mismatch aborts the whole migration transaction.
if { printf 'BEGIN;\n'; cat "$MIGRATIONS/ai_index_expand.sql" "$MIGRATIONS/ai_index_backfill.sql";
  printf "UPDATE lumiere_platform.ai_legacy_index_payload SET payload = '{}' WHERE source_table = 'document';\n";
  cat "$MIGRATIONS/ai_index_verify.sql" "$MIGRATIONS/ai_index_contract.sql"; printf 'COMMIT;\n';
} | psql -X -q -v ON_ERROR_STOP=1 > /dev/null 2>&1; then
  echo 'archive mismatch was accepted' >&2; exit 1
fi
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM document WHERE index_content IS NOT NULL) <> 2 OR
    (SELECT count(*) FROM search_embedding WHERE text IS NOT NULL) <> 2 OR
    to_regclass('lumiere_platform.ai_legacy_index_payload') IS NOT NULL THEN
    RAISE EXCEPTION 'failed migration did not roll back';
 END IF;
END $$;
SQL
{ printf 'BEGIN;\n'; cat "$MIGRATIONS/ai_index_expand.sql" "$MIGRATIONS/ai_index_backfill.sql" "$MIGRATIONS/ai_index_verify.sql" "$MIGRATIONS/ai_index_contract.sql"; printf 'COMMIT;\n';
} | psql -X -q -v ON_ERROR_STOP=1
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM lumiere_platform.ai_legacy_index_payload) <> 4 OR
    NOT EXISTS (SELECT 1 FROM lumiere_platform.ai_legacy_index_payload WHERE organization_id=9 AND company_id=3 AND source_id=3 AND payload='{"text":"passage","embedding":[0.125,0.5],"embedding_hash":"exact-hash"}'::jsonb) OR
    NOT EXISTS (SELECT 1 FROM lumiere_platform.ai_legacy_index_payload WHERE organization_id=10 AND company_id IS NULL AND source_id=4) OR
    EXISTS (SELECT 1 FROM search_embedding WHERE sync_status <> 'failed' OR expected_fingerprint <> '' OR index_generation <> 'legacy-unverified') OR
    (SELECT count(*) FROM document WHERE index_content IS NOT NULL) <> 2 OR
    (SELECT count(*) FROM search_embedding WHERE text <> '') <> 2 OR
    NOT EXISTS (SELECT 1 FROM search_embedding WHERE id=3 AND embedding='[0.125,0.5]'::jsonb AND embedding_hash='exact-hash') THEN
   RAISE EXCEPTION 'migration lost compatibility payload/scope or certified a legacy index';
 END IF;
END $$;
SQL
echo 'AI index migration: archive, tenant scope, quarantine, verification and rollback passed'
# The current projector can create the new shape before adopting history.
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DROP TABLE document, search_embedding, lumiere_platform.ai_legacy_index_payload;
CREATE TABLE document (id NUMERIC(20,0), organization_id NUMERIC(20,0), company_id NUMERIC(20,0));
CREATE TABLE search_embedding (id NUMERIC(20,0), organization_id NUMERIC(20,0), company_id NUMERIC(20,0), expected_fingerprint TEXT NOT NULL, index_generation TEXT NOT NULL, sync_status TEXT, sync_error TEXT);
INSERT INTO search_embedding VALUES (3,9,3,'canonical-fingerprint','canonical-generation','synced',NULL);
SQL
{ printf 'BEGIN;\n'; cat "$MIGRATIONS/ai_index_expand.sql" "$MIGRATIONS/ai_index_backfill.sql" "$MIGRATIONS/ai_index_verify.sql" "$MIGRATIONS/ai_index_contract.sql"; printf 'COMMIT;\n';
} | psql -X -q -v ON_ERROR_STOP=1
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM lumiere_platform.ai_legacy_index_payload) OR
    NOT EXISTS (SELECT 1 FROM search_embedding WHERE id=3 AND expected_fingerprint='canonical-fingerprint' AND index_generation='canonical-generation' AND sync_status='synced') THEN
   RAISE EXCEPTION 'current projection adoption changed canonical data';
 END IF;
END $$;
-- The safe producer retains empty compatibility fields on canonical rows.
ALTER TABLE document ADD COLUMN index_content TEXT;
ALTER TABLE search_embedding ADD COLUMN text TEXT NOT NULL DEFAULT '';
ALTER TABLE search_embedding ADD COLUMN embedding JSONB NOT NULL DEFAULT '[]';
ALTER TABLE search_embedding ADD COLUMN embedding_hash TEXT;
SQL
{ printf 'BEGIN;\n'; cat "$MIGRATIONS/ai_index_backfill.sql" "$MIGRATIONS/ai_index_verify.sql" "$MIGRATIONS/ai_index_contract.sql"; printf 'COMMIT;\n';
} | psql -X -q -v ON_ERROR_STOP=1
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM search_embedding WHERE id=3 AND expected_fingerprint='canonical-fingerprint' AND index_generation='canonical-generation' AND sync_status='synced') THEN
   RAISE EXCEPTION 'compatibility slots quarantined a canonical row';
 END IF;
END $$;
ALTER TABLE search_embedding DROP COLUMN embedding;
SQL
if { printf 'BEGIN;\n'; cat "$MIGRATIONS/ai_index_backfill.sql" "$MIGRATIONS/ai_index_verify.sql" "$MIGRATIONS/ai_index_contract.sql"; printf 'COMMIT;\n';
} | psql -X -q -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
  echo 'partial legacy shape was accepted' >&2; exit 1
fi
echo 'AI index migration: current projection adoption and partial-shape rejection passed'
