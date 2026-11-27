//! Read-only task results for the existing product/contact/location wizards.
//! Native receipts are deliberately distinct from verified journal readback.
use std::collections::BTreeSet;

use futures_util::{stream, StreamExt, TryStreamExt};
use serde_json::{json, Value};
use tokio_postgres::Transaction;

use super::{model, StorageScope};
use crate::{
    cold_tier::pg_pool,
    error::ApiError,
    query_exec::row_u64,
    routes::import::{read_workflow_import, WorkflowImportRequest},
    state::AppState,
    trusted_context::TrustedOperationContext,
};

fn supported(entity: &str) -> bool {
    matches!(entity, "product" | "contact" | "stock_location")
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn record(
    pool: &deadpool_postgres::Pool,
    scope: StorageScope<'_>,
    entity: &str,
    request: &str,
    content_hash: &str,
    file_name: Option<&str>,
    bindings: &[Value],
) -> Result<(), ApiError> {
    if !supported(entity) {
        return Ok(());
    }
    if !model::sha256(content_hash)
        || !valid_request(request)
        || bindings.is_empty()
        || bindings.len() > 1000
    {
        return Err(ApiError::BadRequest(
            "invalid native review request association".into(),
        ));
    }
    let mut batches = BTreeSet::new();
    for row in bindings {
        batches.insert(
            row["batchId"]
                .as_str()
                .and_then(|id| id.parse::<i64>().ok())
                .filter(|id| *id > 0)
                .ok_or_else(|| ApiError::BadRequest("invalid reviewed batch identity".into()))?,
        );
    }
    let batches: Vec<i64> = batches.into_iter().collect();
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    // All exported batches must belong to the task, and only the submitting
    // actor's prepare-import tasks can acquire this association.
    let tasks = tx.query(
        "SELECT link.request_id FROM lumiere_platform.import_task_review link
         JOIN lumiere_platform.import_task task ON task.organization_id=link.organization_id AND task.company_id=link.company_id AND task.actor_identity=link.actor_identity AND task.request_id=link.request_id
         WHERE link.organization_id=$1::text::numeric AND link.company_id=$2::text::numeric AND link.actor_identity=$3
           AND link.batch_id=ANY($4::bigint[]) AND NOT link.from_inspection AND task.approved_mode='prepare_import' AND task.state='needs_review'
         GROUP BY link.request_id HAVING count(DISTINCT link.batch_id)=$5 ORDER BY link.request_id LIMIT 21",
        &[&scope.organization.to_string(),&scope.company.to_string(),&scope.actor,&batches,&(batches.len() as i64)]
    ).await.map_err(ApiError::internal)?;
    if tasks.len() > 20 {
        return Err(ApiError::Conflict(
            "too many saved tasks share this old review; prepare the source again before importing"
                .into(),
        ));
    }
    let rows = json!(bindings);
    for task in tasks {
        record_task(
            &tx,
            scope,
            &task.get::<_, String>("request_id"),
            entity,
            request,
            content_hash,
            file_name,
            &rows,
        )
        .await?;
    }
    tx.commit().await.map_err(ApiError::internal)
}

#[allow(clippy::too_many_arguments)]
async fn record_task(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
    task: &str,
    entity: &str,
    request: &str,
    content_hash: &str,
    file_name: Option<&str>,
    rows: &Value,
) -> Result<(), ApiError> {
    tx.execute("INSERT INTO lumiere_platform.import_task_native_request (organization_id,company_id,actor_identity,task_request_id,native_request_id,entity,content_sha256,file_name,review_rows) VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING",&[&scope.organization.to_string(),&scope.company.to_string(),&scope.actor,&task,&request,&entity,&content_hash,&file_name,&rows]).await.map_err(ApiError::internal)?;
    let existing = tx.query_one("SELECT entity,content_sha256,file_name,review_rows FROM lumiere_platform.import_task_native_request WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND task_request_id=$4 AND native_request_id=$5",&[&scope.organization.to_string(),&scope.company.to_string(),&scope.actor,&task,&request]).await.map_err(ApiError::internal)?;
    if existing.get::<_, String>("entity") != entity
        || existing.get::<_, String>("content_sha256") != content_hash
        || existing.get::<_, Option<String>>("file_name").as_deref() != file_name
        || existing.get::<_, Value>("review_rows") != *rows
    {
        return Err(ApiError::Conflict(
            "this native request belongs to another reviewed export".into(),
        ));
    }
    Ok(())
}

struct Attempt {
    request: String,
    entity: String,
    content_hash: String,
    file_name: Option<String>,
    rows: Value,
    created_at: String,
}

const PAGE_SIZE: usize = 20;

fn valid_request(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

const ATTEMPT_PAGE: &str = "WITH scoped AS NOT MATERIALIZED (
    SELECT native_request_id,entity,content_sha256,file_name,review_rows,created_at
    FROM lumiere_platform.import_task_native_request
    WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND task_request_id=$4
), anchor AS (
    SELECT created_at,native_request_id FROM scoped WHERE native_request_id=$5
)
SELECT native_request_id,entity,content_sha256,file_name,review_rows,created_at::text
FROM scoped WHERE $5::text IS NULL OR (created_at,native_request_id) < (SELECT created_at,native_request_id FROM anchor)
ORDER BY scoped.created_at DESC,native_request_id DESC LIMIT 21";

pub(super) async fn list(
    context: &TrustedOperationContext,
    company: u64,
    task: &str,
    before: Option<&str>,
) -> Result<(Vec<Value>, Option<String>), ApiError> {
    if before.is_some_and(|value| !valid_request(value)) {
        return Err(ApiError::BadRequest("Invalid native receipt cursor".into()));
    }
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    let rows = client
        .query(
            ATTEMPT_PAGE,
            &[
                &context.organization_id().to_string(),
                &company.to_string(),
                &context.actor_identity(),
                &task,
                &before,
            ],
        )
        .await
        .map_err(ApiError::internal)?;
    let next = (rows.len() > PAGE_SIZE).then(|| rows[PAGE_SIZE - 1].get("native_request_id"));
    let attempts = rows.iter().take(PAGE_SIZE).map(attempt).collect::<Vec<_>>();
    drop(client);
    let results = stream::iter(attempts).map(|attempt|async move {
        let request=WorkflowImportRequest {entity:attempt.entity.clone(),company_id:company,request_id:attempt.request.clone(),file_name:attempt.file_name.clone().unwrap_or_default(),csv:String::new()};
        let receipt=match read_workflow_import(context,&request,&attempt.content_hash).await {
            Ok(receipt)=>Some(project_receipt(&receipt,&attempt)?),
            Err(ApiError::NotFound(_))=>None,
            Err(error)=>return Err(error),
        };
        let source_rows=attempt.rows.as_array().ok_or_else(||ApiError::Internal("saved native review rows are malformed".into()))?;
        let review_ids=source_rows.iter().filter_map(|row|row["batchId"].as_str()).collect::<BTreeSet<_>>();
        Ok(json!({"requestId":attempt.request,"entity":attempt.entity,"fileName":attempt.file_name,"contentSha256":attempt.content_hash,"reviewItemCount":source_rows.len(),"reviewIds":review_ids,"submittedAt":attempt.created_at,"state":if receipt.is_some(){"receipt_available"}else{"awaiting_receipt"},"verification":"native_receipt_only","receipt":receipt}))
    }).buffered(4).try_collect::<Vec<_>>().await?;
    Ok((results, next))
}

fn attempt(row: &tokio_postgres::Row) -> Attempt {
    Attempt {
        request: row.get("native_request_id"),
        entity: row.get("entity"),
        content_hash: row.get("content_sha256"),
        file_name: row.get("file_name"),
        rows: row.get("review_rows"),
        created_at: row.get("created_at"),
    }
}

pub(super) async fn row_results(
    state: &AppState,
    context: &TrustedOperationContext,
    company: u64,
    task: &str,
    request: &str,
    after: u64,
) -> Result<Value, ApiError> {
    if !valid_request(request) || after > 1001 {
        return Err(ApiError::BadRequest(
            "Invalid native receipt row page".into(),
        ));
    }
    let org = context.organization_id();
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    let saved = client.query_opt("SELECT native_request_id,entity,content_sha256,file_name,review_rows,created_at::text
        FROM lumiere_platform.import_task_native_request
        WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND task_request_id=$4 AND native_request_id=$5",
        &[&org.to_string(),&company.to_string(),&context.actor_identity(),&task,&request]).await.map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::NotFound("Native receipt not found".into()))?;
    let attempt = attempt(&saved);
    let rows = attempt
        .rows
        .as_array()
        .ok_or_else(|| ApiError::Internal("Invalid receipt source rows".into()))?;
    let native = WorkflowImportRequest {
        entity: attempt.entity.clone(),
        company_id: company,
        request_id: attempt.request.clone(),
        file_name: attempt.file_name.clone().unwrap_or_default(),
        csv: String::new(),
    };
    let receipt = read_workflow_import(context, &native, &attempt.content_hash).await?;
    let projected = project_receipt(&receipt, &attempt)?;
    let job = projected["jobId"]
        .as_str()
        .and_then(|id| id.parse::<u64>().ok())
        .ok_or_else(|| ApiError::Internal("Invalid native receipt job".into()))?;
    let status = projected["status"].as_str().unwrap_or_default();
    let candidates = source_page(rows, after)?;
    let first = candidates.first().map(|(row, _)| *row).unwrap_or(0);
    let last = candidates.last().map(|(row, _)| *row).unwrap_or(0);
    let eligible = matches!(status, "success" | "partial") && !candidates.is_empty();
    let jobs = if eligible {
        state.stdb.query_sql(&format!("SELECT id, organization_id, table_name, status, metadata, create_uid FROM import_job WHERE organization_id = {org} AND id = {job}"))
            .await.map_err(ApiError::internal)?
    } else {
        Vec::new()
    };
    let exact_job = match jobs.as_slice() {
        [row] if job_matches_attempt(row, &attempt, company, status) => Some(row),
        _ => None,
    };
    let mappings = if exact_job.is_some() {
        state.stdb.query_sql(&format!("SELECT id, organization_id, job_id, table_name, record_id, row_number, create_date FROM import_job_record WHERE organization_id = {org} AND job_id = {job} AND row_number >= {first} AND row_number <= {last} LIMIT 41"))
            .await.map_err(ApiError::internal)?
    } else {
        Vec::new()
    };
    let mut output = Vec::new();
    for (import_row, binding) in candidates.iter().take(PAGE_SIZE) {
        let batch = binding["batchId"]
            .as_str()
            .and_then(|id| id.parse::<i64>().ok())
            .filter(|id| *id > 0);
        let item = binding["itemId"]
            .as_str()
            .and_then(|id| id.parse::<i64>().ok())
            .filter(|id| *id > 0);
        let revision = binding["revision"]
            .as_u64()
            .filter(|revision| (1..=i32::MAX as u64).contains(revision));
        let source = if let (Some(batch), Some(item)) = (batch, item) {
            client.query_opt("SELECT source_json FROM lumiere_platform.import_review_item WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND batch_id=$3 AND id=$4",
                &[&org.to_string(),&company.to_string(),&batch,&item]).await.map_err(ApiError::internal)?
                .map(|row| row.get::<_, Value>("source_json"))
        } else {
            None
        };
        let failed = receipt["errors"].as_array().is_some_and(|errors| {
            errors
                .iter()
                .any(|error| error["rowNumber"].as_u64() == Some(*import_row))
        });
        let record = if let Some(job_row) = exact_job.filter(|_| {
            !failed
                && mappings.len() <= 40
                && batch.is_some()
                && item.is_some()
                && revision.is_some()
        }) {
            if let Some((record, mapping)) =
                exact_mapping(&mappings, org, job, &attempt.entity, *import_row)
            {
                match super::super::history::verified_import_destination(
                    &state.stdb,
                    context,
                    mapping,
                    job_row,
                    company,
                    &attempt.entity,
                    record,
                )
                .await
                {
                    Ok(true) => Some(record.to_string()),
                    // Old, unavailable, or unauthorized evidence supplies no destination.
                    _ => None,
                }
            } else {
                None
            }
        } else {
            None
        };
        let (source_file, source_row) = source
            .as_ref()
            .map(|value| &value["source"])
            .filter(|value| {
                !value["rowBasis"]
                    .as_str()
                    .is_some_and(|basis| basis != "source_line")
            })
            .map(|value| (&value["file"], &value["row"]))
            .unzip();
        output.push(json!({
            "importRow": import_row, "sourceFile":source_file.and_then(Value::as_str), "sourceRow":source_row.and_then(Value::as_u64).filter(|row| *row > 0),
            "batchId":batch.map(|id| id.to_string()),"itemId":item.map(|id| id.to_string()),"revision":revision,
            "state":if record.is_some() {"verified"} else if status == "rolled_back" {"rolled_back"} else if failed || status == "failed" {"failed"} else {"unverified"},
            "recordId":record
        }));
    }
    let next_row = (candidates.len() > PAGE_SIZE).then(|| candidates[PAGE_SIZE - 1].0);
    context.require_current_placement(&state.organization_placements)?;
    Ok(
        json!({"organizationId":org.to_string(),"companyId":company.to_string(),"taskId":task,"requestId":request,"entity":attempt.entity,"rows":output,"nextRow":next_row}),
    )
}

fn source_page(rows: &[Value], after: u64) -> Result<Vec<(u64, &Value)>, ApiError> {
    let mut candidates = Vec::new();
    let mut seen = BTreeSet::new();
    for row in rows {
        let index = row["importRow"]
            .as_u64()
            .filter(|index| (2..=(rows.len() + 1) as u64).contains(index))
            .ok_or_else(|| {
                ApiError::Conflict("Native receipt has no exact source-row binding".into())
            })?;
        if !seen.insert(index) {
            return Err(ApiError::Conflict(
                "Native receipt has ambiguous source rows".into(),
            ));
        }
        if index > after {
            candidates.push((index, row));
        }
    }
    candidates.sort_unstable_by_key(|(row, _)| *row);
    candidates.truncate(PAGE_SIZE + 1);
    Ok(candidates)
}

fn job_matches_attempt(row: &Value, attempt: &Attempt, company: u64, status: &str) -> bool {
    let raw = row["metadata"]
        .as_str()
        .or_else(|| row["metadata"]["some"].as_str());
    let metadata = raw.and_then(|value| serde_json::from_str::<Value>(value).ok());
    row["status"] == status
        && metadata.is_some_and(|metadata| {
            metadata["company_id"].as_u64() == Some(company)
                && metadata["request_id"] == attempt.request
                && metadata["sha256"] == attempt.content_hash
        })
}

fn exact_mapping<'a>(
    mappings: &'a [Value],
    org: u64,
    job: u64,
    entity: &str,
    row: u64,
) -> Option<(u64, &'a Value)> {
    let mut candidates = mappings.iter().filter(|mapping| {
        row_u64(mapping, "organizationId", "organization_id")
            .ok()
            .flatten()
            == Some(org)
            && row_u64(mapping, "jobId", "job_id").ok().flatten() == Some(job)
            && mapping
                .get("table_name")
                .or_else(|| mapping.get("tableName"))
                .and_then(Value::as_str)
                == Some(entity)
            && row_u64(mapping, "rowNumber", "row_number").ok().flatten() == Some(row)
    });
    let match_row = candidates.next()?;
    if candidates.next().is_some() {
        return None;
    }
    let record = row_u64(match_row, "recordId", "record_id")
        .ok()
        .flatten()
        .filter(|id| *id > 0)?;
    Some((record, match_row))
}

fn project_receipt(receipt: &Value, attempt: &Attempt) -> Result<Value, ApiError> {
    let status = receipt["status"]
        .as_str()
        .filter(|status| matches!(*status, "success" | "partial" | "failed" | "rolled_back"));
    let job = receipt["jobId"].as_str().filter(|id| {
        !id.starts_with('0')
            && id.bytes().all(|byte| byte.is_ascii_digit())
            && id.parse::<u64>().is_ok_and(|id| id > 0)
    });
    let rows = receipt["totalRows"].as_u64();
    let imported = receipt["rowsImported"].as_u64();
    let errors = receipt["errorRows"].as_u64();
    if receipt["requestId"] != attempt.request
        || receipt["entity"] != attempt.entity
        || status.is_none()
        || job.is_none()
        || rows != attempt.rows.as_array().map(|rows| rows.len() as u64)
        || imported.is_none()
        || errors.is_none()
        || imported > rows
        || errors > rows
        || (status == Some("success") && (imported != rows || errors != Some(0)))
    {
        return Err(ApiError::Conflict(
            "native receipt does not match the saved task export".into(),
        ));
    }
    Ok(
        json!({"jobId":job,"status":status,"totalRows":rows,"rowsImported":imported,"errorRows":errors}),
    )
}

#[cfg(test)]
mod tests;
