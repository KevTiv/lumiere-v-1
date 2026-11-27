-- Keep immutable task ownership and record explicit, revocable recipient access.
create table lumiere_platform.import_task_handoff (
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    actor_identity text not null,
    request_id text not null,
    recipient_identity text,
    revision integer not null check (revision > 0),
    primary key (organization_id, company_id, actor_identity, request_id),
    foreign key (organization_id, company_id, actor_identity, request_id)
        references lumiere_platform.import_task (organization_id, company_id, actor_identity, request_id),
    check (recipient_identity is null or recipient_identity <> actor_identity)
);
create unique index import_task_handoff_recipient
    on lumiere_platform.import_task_handoff (organization_id, company_id, recipient_identity, request_id)
    where recipient_identity is not null;

-- Legacy decision actors are the task creators. New shared decisions retain
-- the authenticated writer alongside the unchanged foreign key.
alter table lumiere_platform.import_task_decision add column decided_by text;
