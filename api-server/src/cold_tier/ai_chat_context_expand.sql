-- Private application state for resumable conversational context. The
-- immutable SpaceTimeDB transcript owns original messages and citations.
create table lumiere_platform.ai_chat_context_checkpoint (
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    actor_identity text not null,
    session_key text not null check (session_key ~ '^[A-Za-z0-9_-]{1,150}$'),
    revision bigint not null check (revision > 0),
    covered_through numeric(20,0) not null check (covered_through > 0),
    checkpoint jsonb not null check (jsonb_typeof(checkpoint) = 'object' and octet_length(checkpoint::text) <= 12288),
    updated_at timestamptz not null default now(),
    primary key (organization_id, company_id, actor_identity, session_key)
);
