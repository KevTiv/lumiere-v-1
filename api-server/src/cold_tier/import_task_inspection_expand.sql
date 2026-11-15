-- Keep completed inspection evidence when the operator prepares the same files.
alter table lumiere_platform.import_task
    add column inspection_json jsonb;

alter table lumiere_platform.import_task_review
    add column from_inspection boolean not null default false;

create or replace function lumiere_platform.keep_import_task_identity() returns trigger language plpgsql as $$
declare
    promotes_inspection boolean := coalesce(
        old.state = 'inspection_ready' and old.approved_mode = 'inspect_only'
        and new.state = 'saved' and new.approved_mode = 'prepare_import'
        and new.decision_revision = old.decision_revision::bigint + 1
        and old.inspection_json is null
        and new.inspection_json = jsonb_build_object(
            'warnings',old.warnings,'coverage',old.coverage_json,
            'preparationReceipt',old.preparation_receipt_json
        )
        and exists (
            select 1 from lumiere_platform.import_task_decision receipt
            where receipt.organization_id = old.organization_id and receipt.company_id = old.company_id
              and receipt.actor_identity = old.actor_identity and receipt.request_id = old.request_id
              and receipt.revision = new.decision_revision and receipt.option_id = 'prepare_import'
              and receipt.request_sha256 = old.request_sha256
              and receipt.question_json = old.decision_request
        ),
        false
    );
begin
    if new.organization_id is distinct from old.organization_id
       or new.company_id is distinct from old.company_id
       or new.actor_identity is distinct from old.actor_identity
       or new.request_id is distinct from old.request_id
       or new.conversation_key is distinct from old.conversation_key
       or new.request_sha256 is distinct from old.request_sha256
       or ((old.approved_mode is not null and new.approved_mode is distinct from old.approved_mode
            or new.inspection_json is distinct from old.inspection_json) and not promotes_inspection) then
        raise exception 'import task submission identity is immutable';
    end if;
    return new;
end;
$$;
