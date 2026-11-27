-- Shared task navigation only. Review decisions remain in their existing tables.
create table lumiere_platform.import_review_checkpoint (
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    actor_identity text not null,
    request_id text not null,
    review_id bigint not null check (review_id > 0),
    issue_group text not null check (octet_length(issue_group) between 1 and 512),
    item_id bigint check (item_id > 0),
    item_revision integer check (item_revision > 0),
    revision integer not null check (revision > 0),
    updated_by text not null,
    primary key (organization_id, company_id, actor_identity, request_id),
    foreign key (organization_id, company_id, actor_identity, request_id)
        references lumiere_platform.import_task (organization_id, company_id, actor_identity, request_id),
    check ((item_id is null) = (item_revision is null))
);
