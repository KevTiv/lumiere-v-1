//! Bounded manifests refer only to immutable files accepted by this task.
use super::{ApiError, Original, Preparation, Value};

pub(super) fn validate_preparation_manifest(
    prepared: &Preparation,
    originals: &[Original],
) -> Result<(), ApiError> {
    let Some(coverage) = &prepared.coverage else {
        if prepared.preparation_receipt.is_some() {
            return Err(invalid());
        }
        // Older preparation workers remain readable during additive rollout.
        return Ok(());
    };
    let files = coverage
        .get("files")
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    if coverage["version"] != 1
        || !coverage["complete"].is_boolean()
        || files.is_empty()
        || files.len() > 400
    {
        return Err(invalid());
    }
    for file in files {
        if !originals.iter().any(|source| {
            file["fileName"] == source.file_name
                && file["sourceSha256"] == source.sha256
                && file["byteCount"].as_u64() == Some(source.bytes.len() as u64)
        }) {
            return Err(invalid());
        }
        let records = file
            .get("records")
            .and_then(Value::as_array)
            .ok_or_else(invalid)?;
        match file["status"].as_str() {
            Some("held") if records.is_empty() && file["recordCount"].is_null() => {}
            Some("prepared") if file["recordCount"].as_u64() == Some(records.len() as u64) => {
                let mut previous = 0;
                for record in records {
                    let number = record["record"].as_u64().ok_or_else(invalid)?;
                    if number <= previous
                        || !matches!(
                            record["disposition"].as_str(),
                            Some("review" | "blank" | "header")
                        )
                    {
                        return Err(invalid());
                    }
                    previous = number;
                }
            }
            _ => return Err(invalid()),
        }
    }
    if originals.iter().any(|source| {
        !files.iter().any(|file| {
            file["fileName"] == source.file_name && file["sourceSha256"] == source.sha256
        })
    }) {
        return Err(invalid());
    }
    let receipt = prepared.preparation_receipt.as_ref().ok_or_else(invalid)?;
    if receipt["version"] != 1
        || receipt["semantics"] != "deterministic_review_proposals"
        || !receipt["engineVersion"]
            .as_str()
            .is_some_and(|version| !version.is_empty() && version.len() <= 200)
        || ["sourceFingerprint", "optionsSha256", "outputSha256"]
            .iter()
            .any(|key| {
                !receipt[*key]
                    .as_str()
                    .is_some_and(super::super::model::sha256)
            })
    {
        return Err(invalid());
    }
    Ok(())
}

fn invalid() -> ApiError {
    ApiError::BadRequest("preparation coverage does not match the saved source files".into())
}
