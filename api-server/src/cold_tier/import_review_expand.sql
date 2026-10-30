-- Source onboarding drafts are operational documents, not ERP ledger rows.
-- Business creation continues through the existing validated import commands.
create table lumiere_platform.import_review_batch (
    id bigserial primary key,
    organization_id numeric(20,0) not null check (organization_id > 0),
    company_id numeric(20,0) not null check (company_id > 0),
    title text not null,
    target_entity text not null,
    source_file text not null,
    source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
    created_by text not null,
    created_at timestamptz not null default now(),
    unique (organization_id, company_id, id),
    unique (organization_id, company_id, source_sha256)
);
create table lumiere_platform.import_review_item (
    id bigserial primary key,
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    batch_id bigint not null,
    source_key text not null,
    source_json jsonb not null,
    proposed_json jsonb not null,
    state text not null default 'needs_review' check (state in ('needs_review','confirmed','excluded')),
    revision integer not null default 1 check (revision > 0),
    reviewed_by text,
    reviewed_at timestamptz,
    reason text,
    foreign key (organization_id, company_id, batch_id)
        references lumiere_platform.import_review_batch (organization_id, company_id, id),
    unique (organization_id, company_id, id),
    unique (batch_id, source_key)
);
create index import_review_item_scope on lumiere_platform.import_review_item (organization_id, company_id, batch_id, id);
create function lumiere_platform.keep_import_review_source() returns trigger language plpgsql as $$
begin
    if new.organization_id is distinct from old.organization_id
       or new.company_id is distinct from old.company_id
       or new.batch_id is distinct from old.batch_id
       or new.source_key is distinct from old.source_key
       or new.source_json is distinct from old.source_json then
        raise exception 'original import review source is immutable';
    end if;
    return new;
end;
$$;
create trigger keep_import_review_source before update on lumiere_platform.import_review_item
    for each row execute function lumiere_platform.keep_import_review_source();
create table lumiere_platform.import_review_decision (
    id bigserial primary key,
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    item_id bigint not null,
    revision integer not null,
    request_key text not null,
    proposed_json jsonb not null,
    state text not null check (state in ('needs_review','confirmed','excluded')),
    reason text not null,
    actor_identity text not null,
    created_at timestamptz not null default now(),
    foreign key (organization_id, company_id, item_id)
        references lumiere_platform.import_review_item (organization_id, company_id, id),
    unique (item_id, revision),
    unique (organization_id, company_id, request_key)
);
