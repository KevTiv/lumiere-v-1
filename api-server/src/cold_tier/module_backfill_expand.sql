create table lumiere_platform.module_backfill_record (
    id bigserial primary key,
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    module text not null check (module in ('sales', 'warehouse')),
    batch_id bigint not null,
    item_id bigint not null,
    source_revision integer not null check (source_revision > 0),
    source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
    source_row bigint not null check (source_row > 0),
    source_file text not null,
    period_start date not null,
    period_end date not null check (period_end >= period_start),
    facts jsonb not null check (jsonb_typeof(facts) = 'object'),
    created_by text not null,
    created_at timestamptz not null default now(),
    foreign key (organization_id, company_id, batch_id)
        references lumiere_platform.import_review_batch (organization_id, company_id, id),
    foreign key (organization_id, company_id, item_id)
        references lumiere_platform.import_review_item (organization_id, company_id, id),
    unique (organization_id, company_id, module, source_sha256, source_row)
);
create index module_backfill_record_listing
    on lumiere_platform.module_backfill_record (organization_id, company_id, module, id desc);
