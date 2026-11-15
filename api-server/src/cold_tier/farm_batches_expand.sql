create table lumiere_platform.farm_batch (
    id bigserial primary key,
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    reference text not null,
    species text not null,
    start_date date not null,
    location text not null,
    revision integer not null default 1 check (revision > 0),
    create_request_key text not null,
    created_by text not null,
    created_at timestamptz not null default now(),
    unique (organization_id, company_id, id),
    unique (organization_id, company_id, create_request_key)
);

create unique index farm_batch_reference
    on lumiere_platform.farm_batch (organization_id, company_id, lower(reference));

create table lumiere_platform.farm_batch_event (
    id bigserial primary key,
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    batch_id bigint not null,
    business_date date not null,
    headcount_delta bigint not null,
    event_json jsonb not null check (jsonb_typeof(event_json) = 'object'),
    source_json jsonb check (jsonb_typeof(source_json) = 'object'),
    revision integer not null default 1 check (revision > 0),
    unique (organization_id, company_id, batch_id, id),
    foreign key (organization_id, company_id, batch_id)
        references lumiere_platform.farm_batch (organization_id, company_id, id)
);

create index farm_batch_timeline
    on lumiere_platform.farm_batch_event (organization_id, company_id, batch_id, business_date, id);

create table lumiere_platform.farm_batch_event_revision (
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    batch_id bigint not null,
    event_id bigint not null,
    revision integer not null check (revision > 0),
    event_json jsonb not null check (jsonb_typeof(event_json) = 'object'),
    source_json jsonb check (jsonb_typeof(source_json) = 'object'),
    request_key text not null,
    reason text,
    recorded_by text not null,
    recorded_at timestamptz not null default now(),
    primary key (event_id, revision),
    unique (organization_id, company_id, batch_id, request_key),
    foreign key (organization_id, company_id, batch_id, event_id)
        references lumiere_platform.farm_batch_event (organization_id, company_id, batch_id, id),
    check ((revision = 1 and reason is null) or (revision > 1 and reason is not null))
);
