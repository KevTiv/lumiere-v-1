use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::{error::ApiError, state::AppState};

use super::{
    super::{
        durable_runs::{ChunkReceipt, RunAuthority, RunChunk, RunGroup, SourceRevision},
        full_administrator, rollout_guard,
    },
    write_reviewed_rows, Module, PreparedTask, Selection, WriteBody,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Configuration {
    rows: Vec<ApprovedRow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApprovedRow {
    batch_id: String,
    item_id: String,
    revision: i32,
    expected_digest: String,
    customer_id: Option<String>,
}

type SourceKey = (i64, i64, i32);

fn canonical_id(text: &str) -> Option<i64> {
    let id = text.parse::<i64>().ok()?;
    (id > 0 && id.to_string() == text).then_some(id)
}

fn invalid() -> ApiError {
    ApiError::BadRequest(
        "reviewed backfill requires exact source revisions and preview digests".into(),
    )
}

fn approvals(
    adapter: &str,
    config: &Value,
    approved: &[SourceRevision],
) -> Result<(Module, BTreeMap<SourceKey, ApprovedRow>), ApiError> {
    let module = match adapter {
        "sales" => Module::Sales,
        "shop_sales" => Module::ShopSales,
        "warehouse" => Module::Warehouse,
        _ => return Err(invalid()),
    };
    let configuration: Configuration =
        serde_json::from_value(config.clone()).map_err(|_| invalid())?;
    if approved.is_empty() || approved.len() != configuration.rows.len() {
        return Err(invalid());
    }
    let mut rows = BTreeMap::new();
    let mut distinct_items = BTreeSet::new();
    for row in configuration.rows {
        let digest = &row.expected_digest;
        if row.revision <= 0
            || digest.len() != 64
            || !digest
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            || row.customer_id.as_ref().is_some_and(|customer| {
                !matches!(module, Module::Sales)
                    || !customer
                        .parse::<u64>()
                        .is_ok_and(|id| id > 0 && id.to_string() == *customer)
            })
        {
            return Err(invalid());
        }
        let key = (
            canonical_id(&row.batch_id).ok_or_else(invalid)?,
            canonical_id(&row.item_id).ok_or_else(invalid)?,
            row.revision,
        );
        if !distinct_items.insert((key.0, key.1)) || rows.insert(key, row).is_some() {
            return Err(invalid());
        }
    }
    let expected = approved
        .iter()
        .map(|r| (r.batch_id, r.item_id, r.revision))
        .collect::<BTreeSet<_>>();
    if !rows.keys().copied().eq(expected) {
        return Err(invalid());
    }
    Ok((module, rows))
}

fn require_authority(authority: &RunAuthority) -> Result<(), ApiError> {
    if authority.context.organization_id() != authority.organization_id
        || authority.context.actor_identity() != authority.actor.as_str()
        || !full_administrator(authority.context.field_access())
    {
        return Err(ApiError::Forbidden(
            "Full organization administration access is required for source review".into(),
        ));
    }
    authority
        .context
        .require_company_scope(&[authority.company_id])
}

pub(in crate::routes::import_reviews) fn validate_durable_group(
    authority: &RunAuthority,
    group: &RunGroup,
) -> Result<(), ApiError> {
    require_authority(authority)?;
    approvals(&group.adapter, &group.config, &group.rows)?;
    Ok(())
}

pub(in crate::routes::import_reviews) async fn execute_chunk(
    state: &AppState,
    authority: &RunAuthority,
    group: &RunGroup,
    chunk: &RunChunk,
) -> Result<ChunkReceipt, ApiError> {
    require_authority(authority)?;
    if rollout_guard::refusal().await.is_some() {
        return Err(ApiError::unavailable(anyhow::anyhow!(
            rollout_guard::PAUSED_MESSAGE
        )));
    }
    let (module, mut approvals) = approvals(&group.adapter, &group.config, &group.rows)?;
    let batch = chunk.rows.first().ok_or_else(invalid)?.batch_id;
    if chunk.rows.len() > 200 || chunk.rows.iter().any(|row| row.batch_id != batch) {
        return Err(invalid());
    }
    let rows = chunk
        .rows
        .iter()
        .map(|row| {
            let approved = approvals
                .remove(&(row.batch_id, row.item_id, row.revision))
                .ok_or_else(invalid)?;
            Ok(Selection {
                item_id: approved.item_id,
                revision: row.revision,
                customer_id: approved.customer_id,
                expected_digest: Some(approved.expected_digest),
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    let result = write_reviewed_rows(
        state,
        &authority.context,
        batch,
        WriteBody {
            company_id: authority.company_id,
            module,
            rows,
            preview: false,
        },
        Some(PreparedTask {
            actor: &authority.creator,
            request: &group.task_id,
        }),
    )
    .await?;
    Ok(ChunkReceipt {
        result: annotate_receipt(result)?,
    })
}

fn invalid_receipt() -> ApiError {
    ApiError::internal(anyhow::anyhow!("invalid reviewed backfill receipt"))
}

fn annotate_receipt(mut result: Value) -> Result<Value, ApiError> {
    let rows = result["results"].as_array().ok_or_else(invalid_receipt)?;
    let mut verified = Vec::with_capacity(rows.len());
    let mut failed = 0;
    let mut held = 0;
    for row in rows {
        match row["status"].as_str() {
            Some("saved" | "matched") => {
                if row["recordId"].as_str().and_then(canonical_id).is_none() {
                    return Err(invalid_receipt());
                }
                let id = row["itemId"]
                    .as_str()
                    .filter(|id| canonical_id(id).is_some())
                    .ok_or_else(invalid_receipt)?;
                verified.push(id.to_owned());
            }
            Some("held") => held += 1,
            Some("conflict") => failed += 1,
            _ => return Err(invalid_receipt()),
        }
    }
    result["verifiedItemIds"] = json!(verified);
    result["failedRows"] = json!(failed);
    result["heldRows"] = json!(held);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn group_requires_one_preview_digest_per_exact_approved_source() {
        let approved = [SourceRevision {
            batch_id: 42,
            item_id: i64::MAX,
            revision: 3,
        }];
        let row = json!({"batchId":"42","itemId":i64::MAX.to_string(),"revision":3,"expectedDigest":"a".repeat(64)});
        for adapter in ["shop_sales", "sales", "warehouse"] {
            assert!(approvals(adapter, &json!({"rows":[row.clone()]}), &approved).is_ok());
        }
        for (key, value) in [
            ("expectedDigest", json!("A".repeat(64))),
            ("expectedDigest", json!(null)),
            ("batchId", json!("042")),
            ("revision", json!(2)),
        ] {
            let mut malformed = row.clone();
            malformed[key] = value;
            assert!(approvals("shop_sales", &json!({"rows":[malformed]}), &approved).is_err());
        }
        let mut optional_customer = row;
        optional_customer["customerId"] = json!("18");
        assert!(
            approvals("sales", &json!({"rows":[optional_customer.clone()]}), &approved).is_ok()
        );
        assert!(approvals("warehouse", &json!({"rows":[optional_customer]}), &approved).is_err());
    }

    #[test]
    fn receipt_separates_verified_records_from_conflicts_and_held_rows() {
        let result = annotate_receipt(json!({"module":"sales","results":[
            {"status":"saved","itemId":"1","recordId":"7"},
            {"status":"matched","itemId":"2","recordId":"8"},
            {"status":"held","itemId":"3"},
            {"status":"conflict","itemId":"4"}
        ]})).unwrap();
        assert_eq!(result["verifiedItemIds"], json!(["1","2"]));
        assert_eq!(result["heldRows"], 1);
        assert_eq!(result["failedRows"], 1);
        assert!(annotate_receipt(json!({"results":[{"status":"saved","itemId":"1"}]})).is_err());
    }
}
