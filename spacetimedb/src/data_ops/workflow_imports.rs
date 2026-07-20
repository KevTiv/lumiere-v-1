//! Validated workflow draft CSV import.

use spacetimedb::ReducerContext;

use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::helpers::check_permission;
use crate::workflow::definitions::{create_workflow, CreateWorkflowParams, WorkflowTrigger};

// ── Workflow ──────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_workflow_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "workflow", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let workflow_key = col(&headers, row, "workflow_key").to_string();
        let name = col(&headers, row, "name").to_string();
        let model = col(&headers, row, "model").to_string();

        if workflow_key.is_empty() || name.is_empty() || model.is_empty() {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("workflow_key"),
                None,
                "workflow_key, name and model are required",
            );
            errors += 1;
            continue;
        }

        let trigger = match parse_trigger(col(&headers, row, "trigger")) {
            Ok(trigger) => trigger,
            Err(message) => {
                record_import_error(ctx, job.id, row_num, Some("trigger"), None, &message);
                errors += 1;
                continue;
            }
        };
        let schema_version = col(&headers, row, "schema_version")
            .parse::<u32>()
            .unwrap_or(1);

        match create_workflow(
            ctx,
            organization_id,
            opt_u64(col(&headers, row, "company_id")),
            CreateWorkflowParams {
                workflow_key,
                model,
                name,
                description: opt_str(col(&headers, row, "description")),
                trigger,
                schema_version,
                snapshot_fields: Vec::new(),
                metadata: opt_str(col(&headers, row, "metadata")),
            },
        ) {
            Ok(()) => imported += 1,
            Err(message) => {
                record_import_error(ctx, job.id, row_num, None, None, &message);
                errors += 1;
            }
        }
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import workflow: imported={}, errors={}", imported, errors);
    Ok(())
}

fn parse_trigger(value: &str) -> Result<WorkflowTrigger, String> {
    match value {
        "" | "manual" => Ok(WorkflowTrigger::Manual),
        "record_created" => Ok(WorkflowTrigger::RecordCreated),
        "record_changed" => Ok(WorkflowTrigger::RecordChanged),
        "signal" => Ok(WorkflowTrigger::Signal),
        _ => Err("trigger must be manual, record_created, record_changed or signal".to_string()),
    }
}
