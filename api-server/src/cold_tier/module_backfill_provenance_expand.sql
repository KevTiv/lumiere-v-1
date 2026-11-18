alter table lumiere_platform.module_backfill_record
    add column source_worksheet text not null default '',
    add column business_key text check (business_key ~ '^[0-9a-f]{64}$');

-- Retain the workbook coordinate of already-saved rows. Historical rows with
-- no retained worksheet keep the empty coordinate used for CSV sources.
update lumiere_platform.module_backfill_record record
set source_worksheet = item.source_json #>> '{source,sheet}'
from lumiere_platform.import_review_item item
where item.organization_id = record.organization_id
  and item.company_id = record.company_id
  and item.id = record.item_id
  and item.source_json #>> '{source,sha256}' = record.source_sha256
  and item.source_json #>> '{source,row}' = record.source_row::text
  and nullif(item.source_json #>> '{source,sheet}', '') is not null;

-- Expand only. The original five-column unique constraint stays in place so an
-- earlier api-server that names it as its conflict target keeps working. The
-- worksheet-aware writer holds a second worksheet that reuses a row number until
-- module_backfill_provenance_contract drops that constraint.
alter table lumiere_platform.module_backfill_record
    add constraint module_backfill_source_coordinate_unique
        unique (organization_id, company_id, module, source_sha256, source_worksheet, source_row);

create unique index module_backfill_business_key_unique
    on lumiere_platform.module_backfill_record (organization_id, company_id, module, business_key)
    where business_key is not null;

create index module_backfill_shop_sale_scope
    on lumiere_platform.module_backfill_record (organization_id, company_id, period_start)
    where module = 'sales' and facts->>'kind' = 'shop_sale';
