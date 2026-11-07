//! Original review links require an approved proposal and its exact native
//! receipt. Arbitrary record metadata never establishes this relationship.
use serde_json::{json, Value};
use tokio_postgres::Client;

use super::{model::*, native};
use crate::{cold_tier::pg_pool, error::ApiError};

#[allow(clippy::too_many_arguments)]
pub(crate) async fn read_workflow_binding(
    org: u64,
    company: u64,
    actor: &str,
    request: &str,
    entity: &str,
    content_hash: &str,
    job: u64,
    record: u64,
    import_row: u64,
) -> Result<Option<Value>, ApiError> {
    if !matches!(entity, "account_move" | "account_move_line") {
        return Ok(None);
    }
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    read_saved_binding(
        &client,
        org,
        company,
        actor,
        request,
        entity,
        content_hash,
        job,
        record,
        import_row,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn read_saved_binding(
    client: &Client,
    org: u64,
    company: u64,
    actor: &str,
    request: &str,
    entity: &str,
    content_hash: &str,
    job: u64,
    record: u64,
    import_row: u64,
) -> Result<Option<Value>, ApiError> {
    let phase = match entity {
        "account_move" => "headers",
        "account_move_line" => "lines",
        _ => return Ok(None),
    };
    let row = client.query_opt(
        "SELECT proposal.id,proposal.task_request_id,proposal.proposal_sha256,proposal.definition_json,receipt.receipt_json
         FROM lumiere_platform.import_workflow_receipt receipt
         JOIN lumiere_platform.import_workflow_proposal proposal
           ON proposal.organization_id=receipt.organization_id AND proposal.company_id=receipt.company_id AND proposal.id=receipt.proposal_id
         WHERE receipt.organization_id=$1::text::numeric AND receipt.company_id=$2::text::numeric
           AND proposal.actor_identity=$3 AND receipt.request_id=$4 AND receipt.phase=$5 AND receipt.content_sha256=$6
           AND receipt.receipt_json->>'jobId'=$7 AND proposal.approved_at IS NOT NULL",
        &[&org.to_string(),&company.to_string(),&actor,&request,&phase,&content_hash,&job.to_string()]
    ).await.map_err(ApiError::internal)?;
    let Some(row) = row else { return Ok(None) };
    let definition: Definition =
        serde_json::from_value(row.get("definition_json")).map_err(ApiError::internal)?;
    let receipt: Value = row.get("receipt_json");
    let expected = if phase == "headers" {
        definition.entries.len()
    } else {
        definition.entries.len() * 2
    };
    let ids = native::receipt_ids(&receipt, expected)?;
    let Some(index) = import_row
        .checked_sub(2)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|index| *index < ids.len())
    else {
        return Ok(None);
    };
    if ids[index] != record {
        return Ok(None);
    }
    let entry_index = if phase == "headers" { index } else { index / 2 };
    let Some(entry) = definition.entries.get(entry_index) else {
        return Ok(None);
    };
    let role = if phase == "headers" {
        "journal_header"
    } else if index % 2 == 0 {
        "journal_debit"
    } else {
        "journal_credit"
    };
    Ok(Some(json!({
        "batchId":entry.batch_id,"itemId":entry.item_id,"revision":entry.source_revision,
        "taskRequestId":row.get::<_,String>("task_request_id"),"proposalId":row.get::<_,i64>("id").to_string(),"proposalDigest":row.get::<_,String>("proposal_sha256"),
        "source":{"file":entry.source_file,"row":entry.source_row,"sha256":entry.source_sha256},"role":role,
    })))
}
