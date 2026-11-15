create table lumiere_platform.farm_import_event (
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    review_batch_id bigint not null,
    review_item_id bigint not null,
    review_revision integer not null check (review_revision > 0),
    source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
    source_sheet text not null,
    source_row integer not null check (source_row > 0),
    source_column integer not null check (source_column between 1 and 16384),
    request_key text not null,
    farm_batch_id bigint not null,
    farm_event_id bigint,
    journal_line_id numeric(20,0),
    verified_at timestamptz not null default now(),
    primary key (organization_id, company_id, review_item_id),
    foreign key (organization_id, company_id, review_batch_id)
        references lumiere_platform.import_review_batch (organization_id, company_id, id),
    foreign key (organization_id, company_id, review_item_id)
        references lumiere_platform.import_review_item (organization_id, company_id, id),
    foreign key (organization_id, company_id, farm_batch_id, farm_event_id)
        references lumiere_platform.farm_batch_event (organization_id, company_id, batch_id, id),
    foreign key (organization_id, company_id, journal_line_id)
        references lumiere_platform.farm_cost_link (organization_id, company_id, journal_line_id),
    check (num_nonnulls(farm_event_id, journal_line_id) = 1)
);

create index farm_import_source_coordinates on lumiere_platform.farm_import_event
    (organization_id, company_id, source_sha256, source_sheet, source_row, source_column);

create index farm_import_review_batch on lumiere_platform.farm_import_event
    (organization_id, company_id, review_batch_id);

create index farm_import_request_identity on lumiere_platform.farm_import_event
    (organization_id, company_id, request_key);
