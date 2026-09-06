\set ON_ERROR_STOP on

CREATE TEMP TABLE cold_pos_order (
    id NUMERIC(20,0) PRIMARY KEY,
    organization_id NUMERIC(20,0) NOT NULL,
    company_id NUMERIC(20,0) NOT NULL,
    payload TEXT NOT NULL
);
CREATE INDEX cold_pos_order_organization_id ON cold_pos_order (organization_id);

INSERT INTO cold_pos_order
SELECT value, (value % 10) + 1, ((value / 10) % 20) + 1, repeat('x', 64)
FROM generate_series(1, 10000) AS value;
ANALYZE cold_pos_order;
\echo baseline_rows_10000
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM cold_pos_order
WHERE organization_id = 1 AND company_id = 1 AND id < 10000
ORDER BY id DESC LIMIT 500;
CREATE INDEX cold_pos_order_read_path
    ON cold_pos_order (organization_id, company_id, id);
ANALYZE cold_pos_order;
\echo generated_index_rows_10000
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM cold_pos_order
WHERE organization_id = 1 AND company_id = 1 AND id < 10000
ORDER BY id DESC LIMIT 500;
DROP INDEX cold_pos_order_read_path;

INSERT INTO cold_pos_order
SELECT value, (value % 10) + 1, ((value / 10) % 20) + 1, repeat('x', 64)
FROM generate_series(10001, 100000) AS value;
ANALYZE cold_pos_order;
\echo baseline_rows_100000
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM cold_pos_order
WHERE organization_id = 1 AND company_id = 1 AND id < 100000
ORDER BY id DESC LIMIT 500;
CREATE INDEX cold_pos_order_read_path
    ON cold_pos_order (organization_id, company_id, id);
ANALYZE cold_pos_order;
\echo generated_index_rows_100000
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM cold_pos_order
WHERE organization_id = 1 AND company_id = 1 AND id < 100000
ORDER BY id DESC LIMIT 500;
DROP INDEX cold_pos_order_read_path;

INSERT INTO cold_pos_order
SELECT value, (value % 10) + 1, ((value / 10) % 20) + 1, repeat('x', 64)
FROM generate_series(100001, 500000) AS value;
ANALYZE cold_pos_order;
\echo baseline_rows_500000
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM cold_pos_order
WHERE organization_id = 1 AND company_id = 1 AND id < 500000
ORDER BY id DESC LIMIT 500;
CREATE INDEX cold_pos_order_read_path
    ON cold_pos_order (organization_id, company_id, id);
ANALYZE cold_pos_order;
\echo generated_index_rows_500000
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM cold_pos_order
WHERE organization_id = 1 AND company_id = 1 AND id < 500000
ORDER BY id DESC LIMIT 500;
