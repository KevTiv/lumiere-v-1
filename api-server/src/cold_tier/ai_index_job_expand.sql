-- Durable queue of ERP records awaiting actor-authorized AI indexing (AIH-30).
-- Deliberately holds no credential of any kind: only the acting identity. A job
-- is executed under that actor's own live session, so every projection keeps the
-- actor's field-level permissions and a missing session simply leaves it pending.
create table lumiere_platform.ai_index_job (
    id bigserial primary key,
    organization_id numeric(20,0) not null check (organization_id > 0),
    company_id numeric(20,0) not null check (company_id > 0),
    actor_identity text not null check (actor_identity ~ '^[0-9a-f]{64}$'),
    resource_kind text not null check (resource_kind in (
        'sale_order', 'purchase_order', 'project_task', 'account_move',
        'mrp_production', 'product', 'contact')),
    resource_id numeric(20,0) not null check (resource_id > 0),
    content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
    status text not null default 'pending'
        check (status in ('pending', 'indexed', 'unchanged', 'withheld', 'failed')),
    attempt_count integer not null default 0 check (attempt_count >= 0),
    last_error text check (last_error is null or length(last_error) <= 200),
    next_attempt_at timestamptz not null default now(),
    claimed_until timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz
);

-- One pending job per actor and record: repeated writes only refresh the hash.
create unique index ai_index_job_pending_unique
    on lumiere_platform.ai_index_job
        (organization_id, company_id, actor_identity, resource_kind, resource_id)
    where status = 'pending';

create index ai_index_job_actor_pending
    on lumiere_platform.ai_index_job (organization_id, actor_identity, next_attempt_at, id)
    where status = 'pending';

create index ai_index_job_company_status
    on lumiere_platform.ai_index_job (organization_id, company_id, status);
