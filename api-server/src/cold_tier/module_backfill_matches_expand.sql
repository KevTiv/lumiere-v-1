alter table lumiere_platform.module_backfill_record
    add unique (organization_id, company_id, id);

-- A verified retry can match an observation originally saved by another
-- review batch. Preserve that batch's readback without writing another record.
create table lumiere_platform.module_backfill_review_match (
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    batch_id bigint not null,
    item_id bigint not null,
    source_revision integer not null check (source_revision > 0),
    record_id bigint not null,
    verified_at timestamptz not null default now(),
    primary key (organization_id, company_id, batch_id, item_id, source_revision, record_id),
    foreign key (organization_id, company_id, batch_id)
        references lumiere_platform.import_review_batch (organization_id, company_id, id),
    foreign key (organization_id, company_id, item_id)
        references lumiere_platform.import_review_item (organization_id, company_id, id),
    foreign key (organization_id, company_id, record_id)
        references lumiere_platform.module_backfill_record (organization_id, company_id, id)
);

create index module_backfill_review_match_record
    on lumiere_platform.module_backfill_review_match (organization_id, company_id, record_id, batch_id);

create view lumiere_platform.module_backfill_review_record as
    select organization_id, company_id, batch_id, id as record_id
    from lumiere_platform.module_backfill_record
    union all
    select organization_id, company_id, batch_id, record_id
    from lumiere_platform.module_backfill_review_match;
