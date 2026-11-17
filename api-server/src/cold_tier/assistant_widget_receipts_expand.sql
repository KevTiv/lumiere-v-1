-- The personal page revision remains the canonical saved outcome.
create table lumiere_platform.assistant_widget_receipt (
    organization_id numeric(20,0) not null check (organization_id > 0),
    company_id numeric(20,0) not null check (company_id > 0),
    actor_identity text not null,
    session_key text not null check (session_key ~ '^[A-Za-z0-9_-]{1,150}$'),
    message_id numeric(20,0) not null check (message_id > 0),
    request_id text not null check (request_id ~ '^[a-f0-9-]{36}$'),
    module_id text not null check (module_id ~ '^[a-z0-9-]{1,64}$'),
    page_id text not null check (page_id ~ '^[a-z0-9-]{1,64}$'),
    widget_id numeric(20,0) not null check (widget_id > 0),
    layout_revision numeric(20,0) not null check (layout_revision > 0),
    created_at timestamptz not null default now(),
    primary key (organization_id, company_id, actor_identity, request_id)
);

create index assistant_widget_receipt_thread
    on lumiere_platform.assistant_widget_receipt
    (organization_id, company_id, actor_identity, session_key, message_id, created_at desc);
