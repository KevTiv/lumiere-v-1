//! Complete outcomes for tracked imports. Private creation evidence is staged
//! by the native row tracker, then committed with exact source rows, job, row
//! mappings and errors after the owner seals request/scope/hash metadata.

use spacetimedb::ReducerContext;
use std::collections::BTreeSet;

use super::import_tracker::{import_job, import_job_error, import_job_record, ImportJobRecord};
use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::core::audit::{audit_log, AuditLog};
use crate::core::business_changes::{
    business_change, merge_business_audit_changes, organization_business_change,
};
use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::crm::contacts::contact;
use crate::inventory::product::product;
use crate::inventory::warehouse::stock_location;

fn source_changes(
    ctx: &ReducerContext,
    record: &ImportJobRecord,
) -> Result<Vec<RowChange>, String> {
    macro_rules! source {
        ($table:ident)=>{{
            let row=ctx.db.$table().id().find(&record.record_id).ok_or("Tracked import source missing")?;
            if row.organization_id!=record.organization_id{return Err("Tracked import source scope mismatch".into());}
            vec![RowChange::upsert_stdb_row(stringify!($table),serde_json::json!({"id":row.id}),&row)?]
        }};
    }
    Ok(match record.table_name.as_str() {
        "product" => source!(product),
        "contact" => source!(contact),
        "stock_location" => source!(stock_location),
        "account_move" => source!(account_move),
        "account_move_line" => {
            let line = ctx
                .db
                .account_move_line()
                .id()
                .find(&record.record_id)
                .ok_or("Tracked import journal line missing")?;
            let parent = ctx
                .db
                .account_move()
                .id()
                .find(&line.move_id)
                .ok_or("Tracked import journal parent missing")?;
            if line.organization_id != record.organization_id
                || parent.organization_id != record.organization_id
                || line.company_id != parent.company_id
            {
                return Err("Tracked journal import source scope mismatch".into());
            }
            vec![
                RowChange::upsert_stdb_row(
                    "account_move",
                    serde_json::json!({"id":parent.id}),
                    &parent,
                )?,
                RowChange::upsert_stdb_row(
                    "account_move_line",
                    serde_json::json!({"id":line.id}),
                    &line,
                )?,
            ]
        }
        _ => return Err("Unsupported tracked import source outcome".into()),
    })
}

fn audit_matches(audit: &AuditLog, record: &ImportJobRecord, actor: spacetimedb::Identity) -> bool {
    let Some(metadata) = audit
        .metadata
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
    else {
        return false;
    };
    audit.organization_id == record.organization_id
        && audit.user_identity == actor
        && audit.table_name == record.table_name
        && audit.record_id == record.record_id
        && audit.action == "CREATE"
        && metadata["import_job_id"].as_str() == Some(record.job_id.to_string().as_str())
        && metadata["import_row"].as_u64() == Some(u64::from(record.row_number))
}

pub(super) fn persist_tracked_import_history(
    ctx: &ReducerContext,
    organization_id: u64,
    job_id: u64,
    submission: &AuditLog,
) -> Result<(), String> {
    let job = ctx
        .db
        .import_job()
        .id()
        .find(&job_id)
        .ok_or("Tracked import outcome job missing")?;
    if !matches!(
        job.table_name.as_str(),
        "product" | "contact" | "stock_location" | "account_move" | "account_move_line"
    ) {
        return Ok(());
    }
    if job.organization_id != organization_id
        || job.create_uid != ctx.sender()
        || job.completed_at.is_none()
    {
        return Err("Tracked import outcome scope mismatch".into());
    }
    let metadata = job
        .metadata
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .ok_or("Tracked import correlation metadata missing")?;
    if metadata["correlation_version"] != 1
        || metadata["request_id"].as_str().is_none()
        || metadata["sha256"].as_str().is_none()
    {
        return Err("Tracked import correlation is not sealed".into());
    }
    if submission.organization_id != organization_id
        || submission.user_identity != job.create_uid
        || submission.table_name != "import_job"
        || submission.record_id != job.id
        || submission.action != "IMPORT_SUBMIT"
    {
        return Err("Tracked import submission audit does not match its native receipt".into());
    }
    let mut changes = vec![RowChange::upsert_stdb_row(
        "import_job",
        serde_json::json!({"id":job.id}),
        &job,
    )?];
    changes.push(RowChange::upsert_stdb_row(
        "audit_log",
        serde_json::json!({"id":submission.id}),
        submission,
    )?);
    let mut evidence = Vec::new();
    let mut sources = BTreeSet::new();
    for record in ctx
        .db
        .import_job_record()
        .import_record_by_job()
        .filter(&job_id)
    {
        if record.organization_id != organization_id || record.table_name != job.table_name {
            return Err("Tracked import mapping scope mismatch".into());
        }
        for row in source_changes(ctx, &record)? {
            let key = (row.table_name.clone(), row.row_identity.to_string());
            if sources.insert(key) {
                changes.push(row);
            }
        }
        changes.push(RowChange::upsert_stdb_row(
            "import_job_record",
            serde_json::json!({"id":record.id}),
            &record,
        )?);
        let mut found = 0;
        for event in ctx
            .db
            .business_change()
            .business_change_by_record()
            .filter((&organization_id, &record.table_name, &record.record_id))
        {
            let Some(audit) = ctx.db.audit_log().id().find(&event.audit_log_id) else {
                continue;
            };
            if event.actor_identity == job.create_uid
                && audit_matches(&audit, &record, job.create_uid)
            {
                evidence.push(RowChange::upsert_stdb_row(
                    "audit_log",
                    serde_json::json!({"id":audit.id}),
                    &audit,
                )?);
                evidence.push(RowChange::upsert_stdb_row(
                    "business_change",
                    serde_json::json!({"id":event.id}),
                    &event,
                )?);
                found += 1;
            }
        }
        for event in ctx
            .db
            .organization_business_change()
            .organization_business_change_by_record()
            .filter((&organization_id, &record.table_name, &record.record_id))
        {
            let Some(audit) = ctx.db.audit_log().id().find(&event.audit_log_id) else {
                continue;
            };
            if event.actor_identity == job.create_uid
                && audit_matches(&audit, &record, job.create_uid)
            {
                evidence.push(RowChange::upsert_stdb_row(
                    "audit_log",
                    serde_json::json!({"id":audit.id}),
                    &audit,
                )?);
                evidence.push(RowChange::upsert_stdb_row(
                    "organization_business_change",
                    serde_json::json!({"id":event.id}),
                    &event,
                )?);
                found += 1;
            }
        }
        if found != 1 {
            return Err(
                "Tracked import requires one exact private creation event per created row".into(),
            );
        }
    }
    for error in ctx
        .db
        .import_job_error()
        .import_error_by_job()
        .filter(&job_id)
    {
        if error.organization_id != organization_id {
            return Err("Tracked import error scope mismatch".into());
        }
        changes.push(RowChange::upsert_stdb_row(
            "import_job_error",
            serde_json::json!({"id":error.id}),
            &error,
        )?);
    }
    let changes = merge_business_audit_changes(changes, evidence)?;
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.import_csv_tracked".into(),
            correlation_id: format!("tracked-import:{job_id}"),
            changes,
        },
    )?;
    Ok(())
}
