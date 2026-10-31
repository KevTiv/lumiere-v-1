-- The organization and company are always server-authorized bind parameters.
-- No ingestion/creation timestamp is used as a business date.
WITH scoped AS (
    SELECT item.*, batch.title, batch.target_entity, batch.source_file
    FROM lumiere_platform.import_review_item item
    JOIN lumiere_platform.import_review_batch batch
      ON batch.id = item.batch_id
     AND batch.organization_id = item.organization_id
     AND batch.company_id = item.company_id
    WHERE item.organization_id = $1::text::numeric
      AND item.company_id = $2::text::numeric
      __SCOPE_FILTERS__
), declared AS MATERIALIZED (
    SELECT id,
        source_json->'businessDate' AS explicit_date,
        coalesce((
            SELECT jsonb_object_agg(field->>'key',
                CASE WHEN scoped.proposed_json ? (field->>'key')
                     THEN scoped.proposed_json->(field->>'key')
                     ELSE field->'sourceValue' END)
            FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(source_json->'fields') = 'array'
                     THEN source_json->'fields' ELSE '[]'::jsonb END
            ) field
            WHERE field->>'kind' = 'date'
        ), '{}'::jsonb) AS date_values,
        coalesce((
            SELECT jsonb_object_agg(field->>'key', field->'sourceValue')
            FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(source_json->'fields') = 'array'
                     THEN source_json->'fields' ELSE '[]'::jsonb END
            ) field
            WHERE field->>'kind' = 'date'
        ), '{}'::jsonb) AS source_date_values
    FROM scoped
), candidates AS MATERIALIZED (
    SELECT declared.*,
        (SELECT count(*) FROM jsonb_each_text(date_values) entry
         WHERE entry.key = ANY(ARRAY['date','business_date','businessDate','source_date','sourceDate','observation_date','observationDate','snapshot_date','snapshotDate','date_order','dateOrder','invoice_date','invoiceDate'])) AS single_count,
        (SELECT min(entry.value) FROM jsonb_each_text(date_values) entry
         WHERE entry.key = ANY(ARRAY['date','business_date','businessDate','source_date','sourceDate','observation_date','observationDate','snapshot_date','snapshotDate','date_order','dateOrder','invoice_date','invoiceDate'])) AS single_value,
        (SELECT min(entry.value) FROM jsonb_each_text(source_date_values) entry
         WHERE entry.key = ANY(ARRAY['date','business_date','businessDate','source_date','sourceDate','observation_date','observationDate','snapshot_date','snapshotDate','date_order','dateOrder','invoice_date','invoiceDate'])) AS single_source_value,
        (SELECT count(*) FROM jsonb_each_text(date_values) entry
         WHERE entry.key = ANY(ARRAY['period_start','periodStart','date_from','dateFrom','start_date','startDate'])) AS start_count,
        (SELECT min(entry.value) FROM jsonb_each_text(date_values) entry
         WHERE entry.key = ANY(ARRAY['period_start','periodStart','date_from','dateFrom','start_date','startDate'])) AS start_value,
        (SELECT count(*) FROM jsonb_each_text(date_values) entry
         WHERE entry.key = ANY(ARRAY['period_end','periodEnd','date_to','dateTo','end_date','endDate'])) AS end_count,
        (SELECT min(entry.value) FROM jsonb_each_text(date_values) entry
         WHERE entry.key = ANY(ARRAY['period_end','periodEnd','date_to','dateTo','end_date','endDate'])) AS end_value
    FROM declared
), identified AS MATERIALIZED (
    SELECT id,
        CASE
            WHEN explicit_date IS NOT NULL AND explicit_date <> 'null'::jsonb THEN explicit_date->>'precision'
            WHEN start_count = 1 AND end_count = 1 AND single_count = 0 THEN 'interval'
            WHEN single_count = 1 AND start_count = 0 AND end_count = 0
                THEN CASE WHEN nullif(btrim(single_value), '') IS NULL THEN 'undated' ELSE 'day' END
            WHEN single_count + start_count + end_count = 0 THEN 'undated'
            ELSE 'invalid'
        END AS requested_precision,
        CASE WHEN explicit_date IS NOT NULL AND explicit_date <> 'null'::jsonb THEN explicit_date->>'from'
             WHEN start_count = 1 AND end_count = 1 AND single_count = 0 THEN start_value
             WHEN single_count = 1 AND start_count = 0 AND end_count = 0 THEN single_value END AS raw_from,
        CASE WHEN explicit_date IS NOT NULL AND explicit_date <> 'null'::jsonb THEN explicit_date->>'toExclusive'
             WHEN start_count = 1 AND end_count = 1 AND single_count = 0 THEN end_value END AS raw_to,
        CASE WHEN explicit_date IS NOT NULL AND explicit_date <> 'null'::jsonb THEN coalesce(explicit_date->>'raw', explicit_date->>'from')
             WHEN single_count = 1 AND start_count = 0 AND end_count = 0 THEN coalesce(single_source_value, single_value)
             WHEN single_count + start_count + end_count > 0 THEN source_date_values::text END AS date_raw,
        CASE WHEN single_count = 1 AND start_count = 0 AND end_count = 0 THEN single_source_value END AS raw_source,
        CASE WHEN explicit_date IS NOT NULL AND explicit_date <> 'null'::jsonb THEN 'source_metadata'
             WHEN single_count = 1 AND start_count = 0 AND end_count = 0 THEN 'review_business_date'
             WHEN start_count = 1 AND end_count = 1 AND single_count = 0 THEN 'review_period_inclusive'
             WHEN single_count + start_count + end_count = 0 THEN 'no_business_date'
             ELSE 'ambiguous_business_date' END AS date_basis
    FROM candidates
), parsed AS MATERIALIZED (
    SELECT identified.*, __PARSE_FROM__ AS parsed_from, __PARSE_TO__ AS parsed_to,
        __PARSE_SOURCE__ AS parsed_source
    FROM identified
), boundaries AS MATERIALIZED (
    SELECT parsed.*,
        CASE WHEN date_basis = 'review_business_date' THEN parsed_from + 1
             WHEN date_basis = 'review_period_inclusive' THEN parsed_to + 1
             ELSE parsed_to END AS parsed_end
    FROM parsed
), classified AS MATERIALIZED (
    SELECT boundaries.*,
        CASE
            WHEN requested_precision = 'undated' AND date_basis = 'review_business_date'
                 AND nullif(btrim(raw_source), '') IS NOT NULL AND parsed_source IS NULL THEN 'invalid'
            WHEN requested_precision IN ('undated', 'invalid') THEN requested_precision
            WHEN parsed_from IS NULL OR parsed_end IS NULL OR parsed_end <= parsed_from THEN 'invalid'
            WHEN parsed_end > DATE '9999-12-31' THEN 'invalid'
            WHEN requested_precision = 'day' AND parsed_end = parsed_from + 1 THEN 'day'
            WHEN requested_precision = 'month' AND extract(day FROM parsed_from) = 1
                 AND parsed_end = (parsed_from + interval '1 month')::date THEN 'month'
            WHEN requested_precision = 'year' AND extract(month FROM parsed_from) = 1
                 AND extract(day FROM parsed_from) = 1
                 AND parsed_end = (parsed_from + interval '1 year')::date THEN 'year'
            WHEN requested_precision = 'interval' THEN 'interval'
            ELSE 'invalid'
        END AS date_precision
    FROM boundaries
), normalized AS (
    SELECT scoped.*, date_precision, date_raw, date_basis,
        CASE WHEN date_precision NOT IN ('undated', 'invalid') THEN parsed_from END AS date_from,
        CASE WHEN date_precision NOT IN ('undated', 'invalid') THEN parsed_end END AS date_to_exclusive
    FROM classified JOIN scoped ON scoped.id = classified.id
)
