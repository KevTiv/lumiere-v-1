/// Import Job Tracker — ImportJob, ImportJobError, ImportJobRecord tables
///
/// Every import reducer creates an ImportJob at the start, logs row-level
/// errors into ImportJobError, records created row IDs into ImportJobRecord,
/// and calls finish_import_job at the end.
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::crm::contacts::{contact, Contact};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::product::{product, Product};

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = import_job,
    public,
    index(accessor = import_job_by_org, btree(columns = [organization_id]))
)]
pub struct ImportJob {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub table_name: String,
    pub file_name: Option<String>,
    pub total_rows: u32,
    pub imported_rows: u32,
    pub error_rows: u32,
    /// "pending" | "success" | "partial" | "failed" | "rolled_back"
    pub status: String,
    pub started_at: Timestamp,
    pub completed_at: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = import_job_error,
    public,
    index(accessor = import_error_by_job, btree(columns = [job_id])),
    index(accessor = import_error_by_organization, btree(columns = [organization_id]))
)]
pub struct ImportJobError {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub job_id: u64,
    pub row_number: u32,
    pub field_name: Option<String>,
    pub raw_value: Option<String>,
    pub error_message: String,
    pub create_date: Timestamp,
}

#[spacetimedb::table(
    accessor = import_job_record,
    public,
    index(accessor = import_record_by_job, btree(columns = [job_id])),
    index(accessor = import_record_by_organization, btree(columns = [organization_id]))
)]
pub struct ImportJobRecord {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub job_id: u64,
    pub table_name: String,
    pub record_id: u64,
    pub row_number: u32,
    pub create_date: Timestamp,
}

// ── Helpers (called by import reducers, not exposed as reducers) ──────────────

/// Create an ImportJob record at the start of an import.
pub fn begin_import_job(
    ctx: &ReducerContext,
    organization_id: u64,
    table_name: &str,
    file_name: Option<String>,
    total_rows: u32,
) -> ImportJob {
    ctx.db.import_job().insert(ImportJob {
        id: 0,
        organization_id,
        table_name: table_name.to_string(),
        file_name,
        total_rows,
        imported_rows: 0,
        error_rows: 0,
        status: "pending".to_string(),
        started_at: ctx.timestamp,
        completed_at: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        metadata: None,
    })
}

/// Record a single row-level error into ImportJobError.
pub fn record_import_error(
    ctx: &ReducerContext,
    job_id: u64,
    row_number: u32,
    field_name: Option<&str>,
    raw_value: Option<&str>,
    error_message: &str,
) {
    let Some(job) = ctx.db.import_job().id().find(&job_id) else {
        log::error!("Cannot record import error for unknown job_id={}", job_id);
        return;
    };
    let entity = job.table_name.clone();
    log::warn!(
        "Import row rejected: entity={} job_id={} row={} field={:?} error={}",
        entity,
        job_id,
        row_number,
        field_name,
        error_message
    );
    ctx.db.import_job_error().insert(ImportJobError {
        id: 0,
        organization_id: job.organization_id,
        job_id,
        row_number,
        field_name: field_name.map(|s| s.to_string()),
        raw_value: raw_value.map(|s| s.to_string()),
        error_message: error_message.to_string(),
        create_date: ctx.timestamp,
    });
}

/// Record a successfully inserted row ID for later rollback.
pub fn record_import_created_id(
    ctx: &ReducerContext,
    job_id: u64,
    table_name: &str,
    record_id: u64,
    row_number: u32,
) {
    let Some(job) = ctx.db.import_job().id().find(&job_id) else {
        log::error!("Cannot record import row for unknown job_id={}", job_id);
        return;
    };
    ctx.db.import_job_record().insert(ImportJobRecord {
        id: 0,
        organization_id: job.organization_id,
        job_id,
        table_name: table_name.to_string(),
        record_id,
        row_number,
        create_date: ctx.timestamp,
    });
}

/// Update the ImportJob with final counts after processing all rows.
pub fn finish_import_job(
    ctx: &ReducerContext,
    job: ImportJob,
    imported_rows: u32,
    error_rows: u32,
) {
    let status = if error_rows == 0 {
        "success"
    } else if imported_rows == 0 {
        "failed"
    } else {
        "partial"
    };

    ctx.db.import_job().id().update(ImportJob {
        imported_rows,
        error_rows,
        status: status.to_string(),
        completed_at: Some(ctx.timestamp),
        ..job
    });
}

fn rollback_delete_record(
    ctx: &ReducerContext,
    organization_id: u64,
    table_name: &str,
    record_id: u64,
) -> Result<(), String> {
    match table_name {
        "contact" => {
            let contact = ctx
                .db
                .contact()
                .id()
                .find(&record_id)
                .ok_or_else(|| format!("Contact {record_id} not found"))?;
            if contact.organization_id != organization_id {
                return Err(format!(
                    "Contact {record_id} does not belong to this organization"
                ));
            }
            if contact.deleted_at.is_some() {
                return Ok(());
            }
            ctx.db.contact().id().update(Contact {
                deleted_at: Some(ctx.timestamp),
                updated_at: ctx.timestamp,
                ..contact
            });
            Ok(())
        }
        "product" => {
            let product_row = ctx
                .db
                .product()
                .id()
                .find(&record_id)
                .ok_or_else(|| format!("Product {record_id} not found"))?;
            if product_row.organization_id != organization_id {
                return Err(format!(
                    "Product {record_id} does not belong to this organization"
                ));
            }
            if !product_row.active {
                return Ok(());
            }
            ctx.db.product().id().update(Product {
                active: false,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..product_row
            });
            Ok(())
        }
        other => Err(format!("Rollback not supported for table: {other}")),
    }
}

// ── Reducers ──────────────────────────────────────────────────────────────────

#[reducer]
pub fn rollback_import_job(
    ctx: &ReducerContext,
    organization_id: u64,
    job_id: u64,
) -> Result<(), String> {
    let job = ctx
        .db
        .import_job()
        .id()
        .find(&job_id)
        .ok_or("Import job not found")?;

    if job.organization_id != organization_id {
        return Err("Import job does not belong to this organization".to_string());
    }

    if job.status == "pending" {
        return Err("Import job is still in progress".to_string());
    }

    if job.status == "rolled_back" {
        return Err("Import job has already been rolled back".to_string());
    }

    check_permission(ctx, organization_id, &job.table_name, "delete")?;

    let records: Vec<ImportJobRecord> = ctx
        .db
        .import_job_record()
        .import_record_by_job()
        .filter(&job_id)
        .collect();

    if records.is_empty() {
        return Err("No import records found for this job".to_string());
    }

    let table_name = job.table_name.clone();
    let mut deleted_count = 0u32;
    for record in &records {
        if record.organization_id != job.organization_id {
            return Err("Import record does not belong to the import job organization".to_string());
        }
        rollback_delete_record(ctx, organization_id, &record.table_name, record.record_id)?;
        ctx.db.import_job_record().id().delete(&record.id);
        deleted_count += 1;
    }

    ctx.db.import_job().id().update(ImportJob {
        status: "rolled_back".to_string(),
        ..job
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "import_job",
            record_id: job_id,
            action: "ROLLBACK",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "table_name": table_name,
                    "deleted_count": deleted_count,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string()],
            metadata: Some(
                serde_json::json!({
                    "job_id": job_id,
                    "deleted_count": deleted_count,
                })
                .to_string(),
            ),
        },
    );

    log::info!(
        "Rollback import job {}: deleted {} {} record(s)",
        job_id,
        deleted_count,
        table_name
    );

    Ok(())
}
