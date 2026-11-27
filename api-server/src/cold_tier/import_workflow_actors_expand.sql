-- Keep proposal/source ownership immutable while attributing real operators.
alter table lumiere_platform.import_workflow_proposal
    add column prepared_by text,
    add column approved_by text,
    add column dispatched_by text;

alter table lumiere_platform.import_task_native_request
    add column submitted_by text;

-- Explicit saved imports bind a native request to one task per submitter.
-- Legacy associations can still describe the same historical receipt in
-- several records and remain unchanged.
create unique index import_task_native_submitter_request
    on lumiere_platform.import_task_native_request (organization_id, submitted_by, native_request_id)
    where submitted_by is not null;
