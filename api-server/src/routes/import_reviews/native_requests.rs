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
    routes::import::{read_workflow_import, WorkflowImportRequest},
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
        || request.len() != 32
        || !request
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
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
           AND link.batch_id=ANY($4::bigint[]) AND task.approved_mode='prepare_import' AND task.state='needs_review'
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

pub(super) async fn list(
    context: &TrustedOperationContext,
    company: u64,
    task: &str,
) -> Result<(Vec<Value>, bool), ApiError> {
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    let rows = client.query("SELECT native_request_id,entity,content_sha256,file_name,review_rows,created_at::text FROM lumiere_platform.import_task_native_request WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND task_request_id=$4 ORDER BY created_at DESC,native_request_id DESC LIMIT 21",&[&context.organization_id().to_string(),&company.to_string(),&context.actor_identity(),&task]).await.map_err(ApiError::internal)?;
    let more = rows.len() > 20;
    let attempts = rows
        .iter()
        .take(20)
        .map(|row| Attempt {
            request: row.get("native_request_id"),
            entity: row.get("entity"),
            content_hash: row.get("content_sha256"),
            file_name: row.get("file_name"),
            rows: row.get("review_rows"),
            created_at: row.get("created_at"),
        })
        .collect::<Vec<_>>();
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
    Ok((results, more))
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
