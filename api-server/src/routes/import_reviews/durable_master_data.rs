//! A reviewed export is immutable input to the existing tracked CSV owner.
use std::collections::{BTreeMap, BTreeSet};

use lumiere_file_inspection::InspectedCsv;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    durable_runs::{ChunkReceipt, RunAuthority, RunChunk, RunGroup, SourceRevision},
    import_binding::validated_review_rows,
    native_requests, StorageScope,
};
use crate::{
    cold_tier::pg_pool,
    error::ApiError,
    routes::import::{
        admit_reviewed_workflow_import, execute_reviewed_workflow_import, validate_csv,
        WorkflowImportRequest,
    },
    state::AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Export {
    entity: String,
    csv_data: String,
    file_name: String,
    currency_id: Option<String>,
}

impl Export {
    fn parse(data: &Value) -> Result<(Self, Option<u64>, InspectedCsv), ApiError> {
        let export: Self = serde_json::from_value(data.clone())
            .map_err(|_| ApiError::BadRequest("Invalid reviewed export".into()))?;
        if !matches!(
            export.entity.as_str(),
            "product" | "contact" | "stock_location"
        ) || !export.file_name.ends_with(".csv")
            || export.file_name.len() > 255
        {
            return Err(ApiError::BadRequest(
                "Invalid reviewed import destination or filename".into(),
            ));
        }
        let currency = export
            .currency_id
            .as_deref()
            .map(|value| {
                value
                    .parse::<u64>()
                    .ok()
                    .filter(|id| *id > 0 && id.to_string() == value)
                    .ok_or_else(|| ApiError::BadRequest("Invalid product currency".into()))
            })
            .transpose()?;
        let inspected = validate_csv(&export.csv_data)?;
        Ok((export, currency, inspected))
    }
}

fn stale() -> ApiError {
    ApiError::Conflict("The reviewed export no longer matches the approved source.".into())
}

fn evidence_columns(csv: &InspectedCsv) -> Result<(usize, usize), ApiError> {
    let index = |name| {
        csv.headers
            .iter()
            .position(|header| header == name)
            .ok_or_else(stale)
    };
    Ok((index("_review_item_id")?, index("_review_revision")?))
}

fn selected_csv(csv: &InspectedCsv, selected: &[SourceRevision]) -> Result<String, ApiError> {
    let (item, revision) = evidence_columns(csv)?;
    let mut source = BTreeMap::new();
    for row in &csv.rows {
        let id: i64 = row[item].parse().map_err(|_| stale())?;
        let rev: i32 = row[revision].parse().map_err(|_| stale())?;
        if source.insert(id, (rev, row)).is_some() {
            return Err(stale());
        }
    }
    let rows = selected
        .iter()
        .map(|entry| match source.remove(&entry.item_id) {
            Some((rev, row)) if rev == entry.revision => Ok(row.as_slice()),
            _ => Err(stale()),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut serialized = String::new();
    for row in std::iter::once(csv.headers.as_slice()).chain(rows) {
        for (index, value) in row.iter().enumerate() {
            if index > 0 {
                serialized.push(',');
            }
            serialized.push('"');
            serialized.push_str(&value.replace('"', "\"\""));
            serialized.push('"');
        }
        serialized.push('\n');
    }
    Ok(serialized)
}

pub(super) async fn validate(
    _state: &AppState,
    authority: &RunAuthority,
    group: &RunGroup,
) -> Result<(), ApiError> {
    let (export, currency, csv) = Export::parse(&group.config)?;
    admit_reviewed_workflow_import(&authority.context, &export.entity, currency)?;
    let (item, revision) = evidence_columns(&csv)?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    let bindings = validated_review_rows(
        &client,
        authority.organization_id,
        authority.company_id,
        &export.entity,
        &csv,
        item,
        revision,
    )
    .await?;
    let approved: BTreeMap<_, _> = group
        .rows
        .iter()
        .map(|row| {
            (
                row.item_id.to_string(),
                (row.batch_id.to_string(), row.revision),
            )
        })
        .collect();
    if csv.rows.len() != approved.len()
        || !bindings.iter().all(|row| {
            row["itemId"]
                .as_str()
                .and_then(|id| approved.get(id))
                .is_some_and(|(batch, revision)| {
                    row["batchId"] == batch.as_str() && row["revision"] == *revision
                })
        })
    {
        return Err(stale());
    }
    Ok(())
}

pub(super) async fn execute_chunk(
    state: &AppState,
    authority: &RunAuthority,
    group: &RunGroup,
    chunk: &RunChunk,
) -> Result<ChunkReceipt, ApiError> {
    let (export, currency, csv) = Export::parse(&group.config)?;
    let receipt = execute_reviewed_workflow_import(
        state,
        &authority.session,
        &authority.context,
        WorkflowImportRequest {
            entity: export.entity.clone(),
            company_id: authority.company_id,
            request_id: chunk.id.clone(),
            file_name: export.file_name,
            csv: selected_csv(&csv, &chunk.rows)?,
        },
        &group.task_id,
        currency,
    )
    .await?;
    if receipt["status"] == "pending" {
        return Err(ApiError::Unavailable(
            "Checking the saved native import.".into(),
        ));
    }
    let scoped = StorageScope {
        organization: authority.organization_id,
        company: authority.company_id,
        actor: &authority.creator,
    };
    let mut verified = BTreeSet::new();
    let mut seen = BTreeSet::new();
    let mut failed = 0;
    let mut cursor = 0;
    let approved: BTreeSet<_> = chunk
        .rows
        .iter()
        .map(|row| row.item_id.to_string())
        .collect();
    loop {
        let page = native_requests::row_results(
            state,
            &authority.context,
            scoped,
            &group.task_id,
            &chunk.id,
            cursor,
        )
        .await?;
        for row in page["rows"].as_array().ok_or_else(stale)? {
            let item = row["itemId"]
                .as_str()
                .filter(|id| approved.contains(*id))
                .ok_or_else(stale)?;
            if !seen.insert(item.to_owned()) {
                return Err(stale());
            }
            match row["state"].as_str() {
                Some("verified") => {
                    verified.insert(item.to_owned());
                }
                Some("failed" | "rolled_back") => failed += 1,
                _ => {
                    return Err(ApiError::Unavailable(
                        "Checking the exact saved record.".into(),
                    ))
                }
            }
        }
        match page["nextRow"].as_u64() {
            Some(next) if next > cursor => cursor = next,
            Some(_) => return Err(stale()),
            None => break,
        }
    }
    if seen != approved {
        return Err(stale());
    }
    Ok(ChunkReceipt {
        result: json!({
            "entity": export.entity, "requestId": chunk.id, "jobId": receipt["jobId"],
            "verifiedItemIds": verified, "failedRows": failed, "heldRows": 0
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_preserves_exact_cells_and_rejects_changed_revisions() -> Result<(), ApiError> {
        let input =
            validate_csv("_review_item_id,_review_revision,name\n1,2,\"Lee, Sr.\"\n2,1,Other\n")?;
        let row = SourceRevision {
            batch_id: 3,
            item_id: 1,
            revision: 2,
        };
        let output = selected_csv(&input, &[row.clone()])?;
        assert_eq!(validate_csv(&output)?.rows, [input.rows[0].clone()]);
        assert!(selected_csv(&input, &[SourceRevision { revision: 3, ..row }]).is_err());
        Ok(())
    }
}
