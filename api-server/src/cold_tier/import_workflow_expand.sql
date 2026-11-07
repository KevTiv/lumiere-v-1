-- Import preparation and business execution have separate durable lifecycles.
-- Existing source bytes, reviewed facts and released migrations remain intact.
alter table lumiere_platform.import_task
    add column preparation_json jsonb,
    add column coverage_json jsonb,
    add column preparation_receipt_json jsonb;

create function lumiere_platform.keep_import_preparation_options() returns trigger language plpgsql as $$
begin
    if new.preparation_json is distinct from old.preparation_json then
        raise exception 'import preparation options are bound to the original submission';
    end if;
    return new;
end;
$$;
create trigger keep_import_preparation_options before update on lumiere_platform.import_task
    for each row execute function lumiere_platform.keep_import_preparation_options();

create table lumiere_platform.import_workflow_proposal (
    id bigserial primary key,
    organization_id numeric(20,0) not null check (organization_id > 0),
    company_id numeric(20,0) not null check (company_id > 0),
    actor_identity text not null,
    task_request_id text not null,
    request_key text not null check (request_key ~ '^[0-9a-f]{32}$'),
    request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
    revision integer not null default 1 check (revision = 1),
    proposal_sha256 text not null check (proposal_sha256 ~ '^[0-9a-f]{64}$'),
    definition_json jsonb not null,
    state text not null check (state in ('prepared','approved','executing','verified','blocked')),
    execution_json jsonb not null,
    verification_json jsonb,
    last_error text,
    created_at timestamptz not null default now(),
    approved_at timestamptz,
    verified_at timestamptz,
    unique (organization_id, company_id, id),
    unique (organization_id, actor_identity, request_key),
    foreign key (organization_id, company_id, actor_identity, task_request_id)
        references lumiere_platform.import_task (organization_id, company_id, actor_identity, request_id)
);
create index import_workflow_task on lumiere_platform.import_workflow_proposal
    (organization_id, company_id, actor_identity, task_request_id, id desc);

-- A source effect is claimed before native dispatch, across all operators and
-- task IDs in this company. A changed review does not erase a prior effect.
create table lumiere_platform.import_workflow_source_claim (
    id bigserial primary key,
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    effect_kind text not null,
    source_key text not null check (source_key ~ '^[0-9a-f]{64}$'),
    proposal_id bigint not null,
    item_id bigint not null,
    source_revision integer not null check (source_revision > 0),
    posting_date date not null,
    business_date_from date not null,
    business_date_to date not null check (business_date_to > business_date_from),
    amount numeric(18,6) not null check (amount > 0),
    currency_id numeric(20,0) not null check (currency_id > 0),
    external_reference text,
    created_at timestamptz not null default now(),
    released_at timestamptz,
    foreign key (organization_id, company_id, proposal_id)
        references lumiere_platform.import_workflow_proposal (organization_id, company_id, id),
    foreign key (organization_id, company_id, item_id)
        references lumiere_platform.import_review_item (organization_id, company_id, id)
);
create unique index import_workflow_active_source_claim on lumiere_platform.import_workflow_source_claim
    (organization_id, company_id, effect_kind, source_key) where released_at is null;
create index import_workflow_expense_candidates on lumiere_platform.import_workflow_source_claim
    (organization_id, company_id, effect_kind, currency_id, amount, business_date_from)
    where released_at is null;
create index import_workflow_reference_candidates on lumiere_platform.import_workflow_source_claim
    (organization_id, company_id, effect_kind, currency_id, external_reference)
    where released_at is null and external_reference is not null;

create table lumiere_platform.import_workflow_receipt (
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    proposal_id bigint not null,
    phase text not null check (phase in ('headers','lines')),
    request_id text not null check (request_id ~ '^[0-9a-f]{32}$'),
    content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
    receipt_json jsonb not null,
    created_at timestamptz not null default now(),
    primary key (proposal_id, phase),
    foreign key (organization_id, company_id, proposal_id)
        references lumiere_platform.import_workflow_proposal (organization_id, company_id, id)
);
create unique index import_workflow_native_receipt on lumiere_platform.import_workflow_receipt
    (organization_id, company_id, request_id);

create function lumiere_platform.keep_import_workflow_definition() returns trigger language plpgsql as $$
begin
    if new.organization_id is distinct from old.organization_id
       or new.company_id is distinct from old.company_id
       or new.actor_identity is distinct from old.actor_identity
       or new.task_request_id is distinct from old.task_request_id
       or new.request_key is distinct from old.request_key
       or new.request_sha256 is distinct from old.request_sha256
       or new.revision is distinct from old.revision
       or new.proposal_sha256 is distinct from old.proposal_sha256
       or new.definition_json is distinct from old.definition_json then
        raise exception 'approved import proposal identity is immutable';
    end if;
    return new;
end;
$$;
create trigger keep_import_workflow_definition before update on lumiere_platform.import_workflow_proposal
    for each row execute function lumiere_platform.keep_import_workflow_definition();
create function lumiere_platform.keep_import_workflow_claim() returns trigger language plpgsql as $$
begin
    if new.organization_id is distinct from old.organization_id
       or new.company_id is distinct from old.company_id
       or new.effect_kind is distinct from old.effect_kind
       or new.source_key is distinct from old.source_key
       or new.proposal_id is distinct from old.proposal_id
       or new.item_id is distinct from old.item_id
       or new.source_revision is distinct from old.source_revision
       or new.posting_date is distinct from old.posting_date
       or new.business_date_from is distinct from old.business_date_from
       or new.business_date_to is distinct from old.business_date_to
       or new.amount is distinct from old.amount
       or new.currency_id is distinct from old.currency_id
       or new.external_reference is distinct from old.external_reference
       or (old.released_at is not null and new.released_at is distinct from old.released_at) then
        raise exception 'source claim identity and its release history are immutable';
    end if;
    return new;
end;
$$;
create trigger keep_import_workflow_claim before update on lumiere_platform.import_workflow_source_claim
    for each row execute function lumiere_platform.keep_import_workflow_claim();
create trigger keep_import_workflow_claim_history before delete on lumiere_platform.import_workflow_source_claim
    for each row execute function lumiere_platform.keep_import_task_decision();
create trigger keep_import_workflow_receipt before update or delete on lumiere_platform.import_workflow_receipt
    for each row execute function lumiere_platform.keep_import_task_decision();
