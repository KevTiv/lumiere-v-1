/// Workflow CSV Imports — Workflow
use spacetimedb::{ReducerContext, Table};

use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::helpers::check_permission;
use crate::workflow::definitions::{workflow, Workflow};

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
        let name = col(&headers, row, "name").to_string();
        let model = col(&headers, row, "model").to_string();

        if name.is_empty() || model.is_empty() {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("name"),
                None,
                "name and model are required",
            );
            errors += 1;
            continue;
        }

        let state_field = {
            let v = col(&headers, row, "state_field");
            if v.is_empty() {
                "state".to_string()
            } else {
                v.to_string()
            }
        };

        ctx.db.workflow().insert(Workflow {
            id: 0,
            organization_id,
            name,
            description: opt_str(col(&headers, row, "description")),
            model,
            state_field,
            on_create: parse_bool(col(&headers, row, "on_create")),
            is_active: true,
            activity_ids: vec![],
            transition_ids: vec![],
            transition_count: 0,
            company_id: opt_u64(col(&headers, row, "company_id")),
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import workflow: imported={}, errors={}", imported, errors);
    Ok(())
}
