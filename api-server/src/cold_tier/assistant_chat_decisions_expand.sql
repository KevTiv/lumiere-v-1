-- Personal, append-only conversation notes. Native workflow receipts stay with
-- their respective owners and are referenced, never copied into this table.
create table lumiere_platform.assistant_chat_decision (
    organization_id numeric(20,0) not null check (organization_id > 0),
    company_id numeric(20,0) not null check (company_id > 0),
    actor_identity text not null,
    session_key text not null check (session_key ~ '^[A-Za-z0-9_-]{1,150}$'),
    message_id numeric(20,0) not null check (message_id > 0),
    decision_id text not null check (decision_id ~ '^[a-f0-9]{32}$'),
    revision integer not null check (revision > 0),
    request_id text not null check (request_id ~ '^[a-f0-9]{32}$'),
    note text not null check (octet_length(note) between 1 and 2000),
    created_at timestamptz not null default now(),
    primary key (organization_id, company_id, actor_identity, decision_id, revision),
    unique (organization_id, company_id, actor_identity, request_id)
);

create index assistant_chat_decision_thread
    on lumiere_platform.assistant_chat_decision
    (organization_id, company_id, actor_identity, session_key, message_id, revision desc);

create function lumiere_platform.keep_assistant_chat_decision() returns trigger language plpgsql as $$
begin
    raise exception 'assistant chat decisions are append-only';
end;
$$;
create trigger assistant_chat_decision_immutable
    before update or delete on lumiere_platform.assistant_chat_decision
    for each row execute function lumiere_platform.keep_assistant_chat_decision();
