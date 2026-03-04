/// Import Job Tracker — ImportJob and ImportJobError tables
///
/// Every import reducer creates an ImportJob at the start, logs row-level
/// errors into ImportJobError, and calls finish_import_job at the end.
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

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
    /// "pending" | "success" | "partial" | "failed"
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
    index(accessor = import_error_by_job, btree(columns = [job_id]))
)]
pub struct ImportJobError {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub job_id: u64,
    pub row_number: u32,
    pub field_name: Option<String>,
    pub raw_value: Option<String>,
    pub error_message: String,
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
    ctx.db.import_job_error().insert(ImportJobError {
        id: 0,
        job_id,
        row_number,
        field_name: field_name.map(|s| s.to_string()),
        raw_value: raw_value.map(|s| s.to_string()),
        error_message: error_message.to_string(),
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
