-- Accepted chat imports are durable preparation tasks, never ERP mutations.
create table lumiere_platform.import_task (
    organization_id numeric(20,0) not null check (organization_id > 0),
    company_id numeric(20,0) not null check (company_id > 0),
    actor_identity text not null,
    request_id text not null check (request_id ~ '^[0-9a-f]{32}$'),
    conversation_key text not null,
    request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
    state text not null default 'awaiting_decision' check (state in ('awaiting_decision','saved','needs_review','inspection_ready','failed')),
    decision_revision integer not null default 1 check (decision_revision > 0),
    decision_request jsonb not null,
    approved_mode text check (approved_mode in ('prepare_import','inspect_only')),
    warnings jsonb not null default '[]',
    error text,
    created_at timestamptz not null default now(),
    primary key (organization_id, actor_identity, request_id),
    unique (organization_id, company_id, actor_identity, request_id),
    check ((state = 'awaiting_decision' and approved_mode is null) or (state <> 'awaiting_decision' and approved_mode is not null))
);
create index import_task_conversation on lumiere_platform.import_task
    (organization_id, company_id, actor_identity, conversation_key, created_at desc);
create table lumiere_platform.import_task_source (
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    actor_identity text not null,
    request_id text not null,
    ordinal integer not null check (ordinal >= 0 and ordinal < 20),
    file_name text not null,
    source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
    original_bytes bytea not null check (octet_length(original_bytes) <= 5000000),
    primary key (organization_id, actor_identity, request_id, ordinal),
    foreign key (organization_id, company_id, actor_identity, request_id)
        references lumiere_platform.import_task (organization_id, company_id, actor_identity, request_id)
);
create table lumiere_platform.import_task_review (
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    actor_identity text not null,
    request_id text not null,
    batch_id bigint not null,
    primary key (organization_id, actor_identity, request_id, batch_id),
    foreign key (organization_id, company_id, actor_identity, request_id)
        references lumiere_platform.import_task (organization_id, company_id, actor_identity, request_id),
    foreign key (organization_id, company_id, batch_id)
        references lumiere_platform.import_review_batch (organization_id, company_id, id)
);
create table lumiere_platform.import_task_decision (
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    actor_identity text not null,
    request_id text not null,
    decision_id text not null check (decision_id ~ '^[0-9a-f]{32}$'),
    revision integer not null check (revision > 1),
    request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
    payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
    question_json jsonb not null,
    option_id text not null check (option_id in ('prepare_import','inspect_only','other')),
    other_text text,
    created_at timestamptz not null default now(),
    primary key (organization_id, actor_identity, decision_id),
    unique (organization_id, actor_identity, request_id, revision),
    foreign key (organization_id, company_id, actor_identity, request_id)
        references lumiere_platform.import_task (organization_id, company_id, actor_identity, request_id),
    check ((option_id = 'other' and other_text is not null) or (option_id <> 'other' and other_text is null))
);
create function lumiere_platform.keep_import_task_source() returns trigger language plpgsql as $$
begin
    raise exception 'original import task source is immutable';
end;
$$;
create trigger keep_import_task_source before update or delete on lumiere_platform.import_task_source
    for each row execute function lumiere_platform.keep_import_task_source();
create function lumiere_platform.keep_import_task_decision() returns trigger language plpgsql as $$
begin
    raise exception 'import task decisions are append-only';
end;
$$;
create trigger keep_import_task_decision before update or delete on lumiere_platform.import_task_decision
    for each row execute function lumiere_platform.keep_import_task_decision();
create function lumiere_platform.keep_import_task_identity() returns trigger language plpgsql as $$
begin
    if new.organization_id is distinct from old.organization_id
       or new.company_id is distinct from old.company_id
       or new.actor_identity is distinct from old.actor_identity
       or new.request_id is distinct from old.request_id
       or new.conversation_key is distinct from old.conversation_key
       or new.request_sha256 is distinct from old.request_sha256
       or (old.approved_mode is not null and new.approved_mode is distinct from old.approved_mode) then
        raise exception 'import task submission identity is immutable';
    end if;
    return new;
end;
$$;
create trigger keep_import_task_identity before update on lumiere_platform.import_task
    for each row execute function lumiere_platform.keep_import_task_identity();
