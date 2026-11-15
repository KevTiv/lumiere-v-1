//! Bounded manifests refer only to immutable files accepted by this task.
use super::{ApiError, Original, Preparation, Value};
use std::collections::{BTreeMap, BTreeSet};

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
    let mut worksheets_by_file = BTreeMap::<&str, BTreeSet<Option<&str>>>::new();
    for file in files {
        let file_name = file["fileName"].as_str().ok_or_else(invalid)?;
        if !originals.iter().any(|source| {
            file["fileName"] == source.file_name
                && file["sourceSha256"] == source.sha256
                && file["byteCount"].as_u64() == Some(source.bytes.len() as u64)
        }) {
            return Err(invalid());
        }
        let worksheet = match &file["worksheet"] {
            Value::Null => None,
            Value::String(name) if valid_worksheet_name(name) => Some(name.as_str()),
            _ => return Err(invalid()),
        };
        if let Some(available) = file.get("availableWorksheets") {
            let available = available
                .as_array()
                .filter(|names| !names.is_empty() && names.len() <= 20)
                .ok_or_else(invalid)?;
            let names = available
                .iter()
                .map(|name| name.as_str().filter(|name| valid_worksheet_name(name)))
                .collect::<Option<BTreeSet<_>>>()
                .ok_or_else(invalid)?;
            if names.len() != available.len()
                || worksheet.is_some_and(|name| !names.contains(name))
                || !file_name.to_ascii_lowercase().ends_with(".xlsx")
            {
                return Err(invalid());
            }
        }
        let seen = worksheets_by_file.entry(file_name).or_default();
        if (!seen.is_empty() && (worksheet.is_none() || seen.contains(&None)))
            || !seen.insert(worksheet)
        {
            return Err(invalid());
        }
        if file.get("workbookLayoutSha256").is_some_and(|value| {
            !value.as_str().is_some_and(super::super::model::sha256)
                || worksheet.is_none()
                || file.get("availableWorksheets").is_none()
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

fn valid_worksheet_name(name: &str) -> bool {
    !name.trim().is_empty()
        && name.len() <= 255
        && !name.chars().any(|character| character.is_ascii_control())
}
