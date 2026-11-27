-- Bind approved work to the saved source and real operator before dispatch.
create table lumiere_platform.import_run (
    id text primary key check (id ~ '^[a-f0-9]{64}$'),
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    creator_identity text not null,
    task_id text not null,
    approved_by text not null,
    platform_user_id text not null,
    adapter text not null,
    config jsonb not null,
    source_rows jsonb not null,
    depends_on text[] not null default '{}',
    created_at timestamptz not null default now(),
    foreign key (organization_id, company_id, creator_identity, task_id)
        references lumiere_platform.import_task (organization_id, company_id, actor_identity, request_id)
);
create index import_run_task on lumiere_platform.import_run
    (organization_id, company_id, creator_identity, task_id, created_at desc, id desc);

create table lumiere_platform.import_run_request (
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    creator_identity text not null,
    task_id text not null,
    request_id text not null check (request_id ~ '^[a-f0-9]{32}$'),
    run_id text not null references lumiere_platform.import_run(id),
    primary key (organization_id, company_id, creator_identity, task_id, request_id)
);
create table lumiere_platform.import_run_chunk (
    id text primary key check (id ~ '^[a-f0-9]{32}$'),
    run_id text not null references lumiere_platform.import_run(id),
    ordinal integer not null check (ordinal >= 0),
    source_rows jsonb not null,
    status text not null default 'queued' check (status in ('queued','running','verified','partial','failed','blocked')),
    attempts integer not null default 0 check (attempts >= 0),
    lease_token text,
    lease_until timestamptz,
    available_at timestamptz not null default now(),
    receipt jsonb,
    verified_item_ids bigint[] not null default '{}',
    last_error text,
    unique (run_id, ordinal),
    check ((status = 'running') = (lease_token is not null)),
    check ((status = 'running') = (lease_until is not null))
);
create index import_run_claimable on lumiere_platform.import_run_chunk
    (available_at, run_id, ordinal) where status in ('queued','running');

-- Reapproving a changed row or changing reviewer cannot double-dispatch it.
create table lumiere_platform.import_run_source_claim (
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    creator_identity text not null,
    task_id text not null,
    adapter text not null,
    item_id bigint not null,
    run_id text not null references lumiere_platform.import_run(id),
    primary key (organization_id, company_id, creator_identity, task_id, adapter, item_id),
    foreign key (organization_id, company_id, item_id)
        references lumiere_platform.import_review_item (organization_id, company_id, id)
);
