-- A reusable recipe only creates new review proposals. It never carries an
-- item confirmation, native-operation approval, or business-record identity.
create table lumiere_platform.import_recipe (
    organization_id numeric(20,0) not null check (organization_id > 0),
    company_id numeric(20,0) not null check (company_id > 0),
    actor_identity text not null,
    recipe_key text not null check (recipe_key ~ '^[a-z][a-z0-9_-]{0,99}$'),
    latest_version integer not null default 0 check (latest_version >= 0),
    primary key (organization_id, company_id, actor_identity, recipe_key)
);

create table lumiere_platform.import_recipe_version (
    organization_id numeric(20,0) not null,
    company_id numeric(20,0) not null,
    actor_identity text not null,
    recipe_key text not null,
    version integer not null check (version > 0),
    name text not null check (octet_length(name) between 1 and 200),
    request_id text not null check (request_id ~ '^[0-9a-f]{32}$'),
    request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
    source_request_id text not null,
    document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
    document_json jsonb not null check (jsonb_typeof(document_json) = 'object'),
    created_at timestamptz not null default now(),
    primary key (organization_id, company_id, actor_identity, recipe_key, version),
    unique (organization_id, company_id, actor_identity, request_id),
    foreign key (organization_id, company_id, actor_identity, recipe_key)
        references lumiere_platform.import_recipe (organization_id, company_id, actor_identity, recipe_key),
    foreign key (organization_id, company_id, actor_identity, source_request_id)
        references lumiere_platform.import_task (organization_id, company_id, actor_identity, request_id)
);

create function lumiere_platform.reject_import_recipe_version_mutation()
returns trigger language plpgsql as $$
begin
    raise exception 'saved import recipe versions are immutable';
end;
$$;

create trigger import_recipe_version_immutable
before update or delete on lumiere_platform.import_recipe_version
for each row execute function lumiere_platform.reject_import_recipe_version_mutation();
