-- Existing native wizards retain their operation owners; a saved task records
-- only exact, server-validated review-export requests and their source scope.
create table lumiere_platform.import_task_native_request (
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    actor_identity text not null,
    task_request_id text not null,
    native_request_id text not null check (native_request_id ~ '^[0-9a-f]{32}$'),
    entity text not null check (entity in ('product','contact','stock_location')),
    content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
    file_name text,
    review_rows jsonb not null check (jsonb_typeof(review_rows)='array' and jsonb_array_length(review_rows) between 1 and 1000),
    created_at timestamptz not null default now(),
    primary key (organization_id, company_id, actor_identity, task_request_id, native_request_id),
    foreign key (organization_id, company_id, actor_identity, task_request_id)
        references lumiere_platform.import_task (organization_id, company_id, actor_identity, request_id)
);
create index import_task_native_request_list on lumiere_platform.import_task_native_request
    (organization_id, company_id, actor_identity, task_request_id, created_at desc, native_request_id desc);
create trigger keep_import_task_native_request before update or delete on lumiere_platform.import_task_native_request
    for each row execute function lumiere_platform.keep_import_task_decision();
