//! Version-one internal controller messages. None of these payloads is an
//! application-contract authorization grant or a model-supplied tenant scope.

use std::collections::BTreeSet;

use anyhow::{ensure, Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub(super) const MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_RESPONSE_BYTES: usize = 256 * 1024;
const MAX_PROGRAM_BYTES: usize = 64 * 1024;
const MAX_DATASETS: usize = 8;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct SandboxScope {
    pub actor_identity: String,
    pub organization_id: String,
    pub company_id: String,
    pub run_id: String,
    pub policy_generation: String,
}

impl SandboxScope {
    pub(super) fn validate(&self) -> Result<()> {
        identifier(&self.actor_identity, 256)?;
        decimal_id(&self.organization_id)?;
        decimal_id(&self.company_id)?;
        decimal_id(&self.run_id)?;
        ensure!(
            is_hash(&self.policy_generation),
            "sandbox policy generation must be a SHA-256 hash"
        );
        Ok(())
    }
}

fn decimal_id(value: &str) -> Result<()> {
    let parsed = value
        .parse::<u64>()
        .context("sandbox scope ID must be a decimal u64")?;
    ensure!(
        parsed > 0 && parsed.to_string() == value,
        "sandbox scope ID is not a canonical positive decimal"
    );
    Ok(())
}

fn identifier(value: &str, max: usize) -> Result<()> {
    ensure!(
        !value.is_empty()
            && value.len() <= max
            && value.trim() == value
            && !value.chars().any(char::is_control),
        "sandbox identifier is invalid"
    );
    Ok(())
}

pub(super) fn is_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn dataset_id(value: &str) -> Result<()> {
    ensure!(
        value.strip_prefix("ds_").is_some_and(|suffix| {
            suffix.len() == 32
                && suffix
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        }),
        "sandbox dataset handle is invalid"
    );
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct DatasetSchema {
    #[serde(rename = "ref")]
    pub schema_ref: String,
    pub fields: Vec<DatasetField>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct DatasetField {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: DatasetFieldType,
    #[serde(default)]
    pub nullable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DatasetFieldType {
    String,
    Number,
    Boolean,
}

impl DatasetSchema {
    pub(super) fn validate(&self) -> Result<()> {
        identifier(&self.schema_ref, 128)?;
        ensure!(
            !self.fields.is_empty() && self.fields.len() <= 64,
            "sandbox dataset schema field limit exceeded"
        );
        let mut names = BTreeSet::new();
        for field in &self.fields {
            identifier(&field.name, 128)?;
            ensure!(
                !matches!(
                    field.name.as_str(),
                    "__proto__" | "prototype" | "constructor"
                ) && names.insert(&field.name),
                "sandbox dataset schema has an unsafe or duplicate field"
            );
        }
        Ok(())
    }

    fn validate_rows(&self, rows: &[Value]) -> Result<()> {
        ensure!(
            rows.len() <= 1_000,
            "sandbox acquisition row limit exceeded"
        );
        for row in rows {
            let object = row
                .as_object()
                .context("sandbox dataset row must be an object")?;
            ensure!(
                object.len() == self.fields.len(),
                "sandbox dataset row fields differ from reviewed schema"
            );
            for field in &self.fields {
                let value = object
                    .get(&field.name)
                    .context("sandbox dataset row is missing a reviewed field")?;
                let valid = match field.kind {
                    DatasetFieldType::String => {
                        value.as_str().is_some_and(|text| text.len() <= 16_384)
                    }
                    DatasetFieldType::Number => value.as_f64().is_some_and(|number| {
                        number.is_finite()
                            && (number.fract() != 0.0 || number.abs() <= 9_007_199_254_740_991.0)
                    }),
                    DatasetFieldType::Boolean => value.is_boolean(),
                };
                ensure!(
                    valid || (field.nullable && value.is_null()),
                    "sandbox dataset value violates reviewed schema"
                );
            }
        }
        Ok(())
    }
}

impl DatasetSchema {
    /// Narrow an authorized row to the fields selected by the released source.
    /// Values outside the reviewed schema never cross the controller boundary.
    pub(super) fn project_rows(&self, rows: &[Value]) -> Result<Vec<Value>> {
        self.validate()?;
        ensure!(
            rows.len() <= 1_000,
            "sandbox acquisition row limit exceeded"
        );
        let mut projected = Vec::with_capacity(rows.len());
        for row in rows {
            let object = row
                .as_object()
                .context("sandbox source row must be an object")?;
            let mut selected = serde_json::Map::new();
            for field in &self.fields {
                selected.insert(
                    field.name.clone(),
                    object
                        .get(&field.name)
                        .context("sandbox source is missing a reviewed field")?
                        .clone(),
                );
            }
            projected.push(Value::Object(selected));
        }
        self.validate_rows(&projected)?;
        Ok(projected)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DatasetIssueRequest {
    pub scope: SandboxScope,
    pub schema: DatasetSchema,
    pub rows: Vec<Value>,
    pub expires_at: String,
    pub source_capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub watermark: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance_ref: Option<String>,
}

impl DatasetIssueRequest {
    pub(super) fn validate(&self) -> Result<()> {
        self.scope.validate()?;
        self.schema.validate()?;
        self.schema.validate_rows(&self.rows)?;
        ensure!(
            !self.source_capabilities.is_empty() && self.source_capabilities.len() <= 8,
            "sandbox source capability limit exceeded"
        );
        for capability in &self.source_capabilities {
            identifier(capability, 128)?;
        }
        for reference in [&self.watermark, &self.provenance_ref]
            .into_iter()
            .flatten()
        {
            identifier(reference, 256)?;
        }
        let expiry = DateTime::parse_from_rfc3339(&self.expires_at)
            .context("sandbox dataset expiry is invalid")?;
        let remaining = expiry.with_timezone(&Utc) - Utc::now();
        ensure!(
            remaining.num_seconds() > 0
                && remaining.num_seconds() <= super::MAX_DATASET_TTL_SECONDS,
            "sandbox dataset expiry exceeds its authority window"
        );
        Ok(())
    }
}

/// The only dataset representation suitable for future model context.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct DatasetHandle {
    pub id: String,
    pub schema_ref: String,
    pub row_count: u32,
    pub expires_at: String,
    pub source_capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub watermark: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance_ref: Option<String>,
}

impl DatasetHandle {
    pub(super) fn validate_against(&self, request: &DatasetIssueRequest) -> Result<()> {
        dataset_id(&self.id)?;
        ensure!(
            self.schema_ref == request.schema.schema_ref,
            "sandbox dataset schema substitution denied"
        );
        ensure!(
            usize::try_from(self.row_count)? == request.rows.len(),
            "sandbox dataset row count mismatch"
        );
        ensure!(
            self.source_capabilities == request.source_capabilities,
            "sandbox source capability substitution denied"
        );
        ensure!(
            self.watermark == request.watermark && self.provenance_ref == request.provenance_ref,
            "sandbox dataset provenance substitution denied"
        );
        let expiry = DateTime::parse_from_rfc3339(&self.expires_at)
            .context("sandbox handle expiry is invalid")?;
        let bound = DateTime::parse_from_rfc3339(&request.expires_at)?;
        ensure!(
            expiry <= bound && expiry.with_timezone(&Utc) > Utc::now(),
            "sandbox handle expiry exceeds its authority window"
        );
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DatasetEnvelope {
    pub dataset: DatasetHandle,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecutionRequest {
    pub scope: SandboxScope,
    pub request_key: String,
    pub program: String,
    pub dataset_ids: Vec<String>,
    pub profile_ref: String,
}

impl ExecutionRequest {
    pub(super) fn new(
        scope: SandboxScope,
        program: String,
        mut dataset_ids: Vec<String>,
        profile_ref: String,
    ) -> Result<Self> {
        scope.validate()?;
        ensure!(
            !program.trim().is_empty() && program.len() <= MAX_PROGRAM_BYTES,
            "sandbox program byte limit exceeded"
        );
        identifier(&profile_ref, 128)?;
        validate_dataset_ids(&dataset_ids)?;
        dataset_ids.sort();
        let identity = serde_json::to_vec(&(&scope, &program, &dataset_ids, &profile_ref))?;
        Ok(Self {
            scope,
            request_key: format!("{:x}", Sha256::digest(identity)),
            program,
            dataset_ids,
            profile_ref,
        })
    }
}

fn validate_dataset_ids(ids: &[String]) -> Result<()> {
    ensure!(
        !ids.is_empty() && ids.len() <= MAX_DATASETS,
        "sandbox dataset count limit exceeded"
    );
    let mut seen = BTreeSet::new();
    for id in ids {
        dataset_id(id)?;
        ensure!(seen.insert(id), "sandbox dataset handles must be unique");
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ExecutionStatus {
    Accepted,
    Creating,
    Running,
    Completed,
    Failed,
    Cancelled,
    OutcomeUnknown,
    CleanupPending,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct EvidenceRecord {
    pub kind: String,
    pub value: Value,
    pub source_datasets: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ArtifactRecord {
    pub name: String,
    pub mime_type: String,
    pub content: String,
    pub source_datasets: Vec<String>,
    pub sha256: String,
    pub bytes: usize,
}

fn validate_sources(sources: &[String], inputs: &[String]) -> Result<()> {
    validate_dataset_ids(sources)?;
    ensure!(
        sources.iter().all(|id| inputs.contains(id)),
        "sandbox evidence cites a foreign dataset"
    );
    Ok(())
}

fn exact_fields(value: &Value, expected: &[&str]) -> Result<()> {
    let object = value
        .as_object()
        .context("sandbox evidence must be an object")?;
    ensure!(
        object.len() == expected.len() && expected.iter().all(|name| object.contains_key(*name)),
        "sandbox evidence fields are invalid"
    );
    Ok(())
}

fn validate_metric(value: &Value) -> Result<()> {
    exact_fields(value, &["label", "value", "count"])?;
    identifier(
        value["label"]
            .as_str()
            .context("sandbox metric label is missing")?,
        64,
    )?;
    ensure!(
        value["value"].as_f64().is_some_and(f64::is_finite),
        "sandbox metric value must be finite"
    );
    ensure!(
        value["count"].as_u64().is_some_and(|count| count >= 3),
        "sandbox metric disclosure group is too small"
    );
    Ok(())
}

fn validate_evidence(kind: &str, value: &Value) -> Result<()> {
    match kind {
        "aggregate" => validate_metric(value)?,
        "summary" => {
            exact_fields(value, &["metrics"])?;
            let metrics = value["metrics"]
                .as_array()
                .context("sandbox summary metrics are missing")?;
            ensure!(
                !metrics.is_empty() && metrics.len() <= 32,
                "sandbox summary metric limit exceeded"
            );
            for metric in metrics {
                validate_metric(metric)?;
            }
        }
        "table" => {
            exact_fields(value, &["columns", "rows"])?;
            let columns = value["columns"]
                .as_array()
                .context("sandbox evidence columns are missing")?;
            ensure!(
                !columns.is_empty() && columns.len() <= 16,
                "sandbox evidence column limit exceeded"
            );
            for label in columns {
                identifier(
                    label.as_str().context("sandbox table column is invalid")?,
                    64,
                )?;
            }
            let rows = value["rows"]
                .as_array()
                .context("sandbox evidence rows are missing")?;
            ensure!(rows.len() <= 32, "sandbox evidence row limit exceeded");
            for row in rows {
                exact_fields(row, &["values", "count"])?;
                ensure!(
                    row["count"].as_u64().is_some_and(|count| count >= 3),
                    "sandbox table disclosure group is too small"
                );
                let cells = row["values"]
                    .as_array()
                    .context("sandbox table cells are missing")?;
                ensure!(
                    cells.len() == columns.len()
                        && cells
                            .iter()
                            .all(|cell| cell.as_f64().is_some_and(f64::is_finite)),
                    "sandbox table cells must match finite numeric columns"
                );
            }
        }
        _ => anyhow::bail!("sandbox evidence kind is not admitted"),
    }
    Ok(())
}

/// Control-plane inspection only. The existing answer gate must still admit
/// any evidence selected from this record; it is never a released answer.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ExecutionSnapshot {
    pub request_key: String,
    pub status: ExecutionStatus,
    pub scope: SandboxScope,
    pub profile_ref: String,
    pub program_hash: String,
    pub dataset_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub evidence: Vec<EvidenceRecord>,
    #[serde(default)]
    pub artifacts: Vec<ArtifactRecord>,
    pub failure_code: Option<String>,
}

impl ExecutionSnapshot {
    pub(super) fn validate_metadata(&self) -> Result<()> {
        self.scope.validate()?;
        ensure!(
            is_hash(&self.request_key) && is_hash(&self.program_hash),
            "sandbox execution fingerprint is invalid"
        );
        identifier(&self.profile_ref, 128)?;
        validate_dataset_ids(&self.dataset_ids)?;
        DateTime::parse_from_rfc3339(&self.created_at)
            .context("sandbox execution creation time is invalid")?;
        DateTime::parse_from_rfc3339(&self.updated_at)
            .context("sandbox execution update time is invalid")?;
        ensure!(
            self.evidence.len() <= 32 && self.artifacts.len() <= 8,
            "sandbox execution output count limit exceeded"
        );
        ensure!(
            self.status == ExecutionStatus::Completed
                || (self.evidence.is_empty() && self.artifacts.is_empty()),
            "sandbox output is unavailable until execution and cleanup complete"
        );
        for evidence in &self.evidence {
            validate_sources(&evidence.source_datasets, &self.dataset_ids)?;
            validate_evidence(&evidence.kind, &evidence.value)?;
        }
        for artifact in &self.artifacts {
            validate_sources(&artifact.source_datasets, &self.dataset_ids)?;
            ensure!(
                !artifact.name.is_empty()
                    && artifact.name.len() <= 128
                    && artifact
                        .name
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric()
                            || matches!(byte, b'.' | b'-' | b'_'))
                    && !artifact.name.starts_with('.'),
                "sandbox artifact name is invalid"
            );
            ensure!(
                artifact.mime_type == "application/json",
                "sandbox artifact MIME type is not admitted"
            );
            ensure!(
                artifact.bytes == artifact.content.len() && artifact.bytes <= 32_768,
                "sandbox artifact byte limit exceeded"
            );
            ensure!(
                artifact.sha256 == format!("{:x}", Sha256::digest(artifact.content.as_bytes())),
                "sandbox artifact content hash mismatch"
            );
            let data: Value = serde_json::from_str(&artifact.content)
                .context("sandbox artifact content is not JSON")?;
            exact_fields(&data, &["kind", "value"])?;
            validate_evidence(
                data["kind"]
                    .as_str()
                    .context("sandbox artifact kind is invalid")?,
                &data["value"],
            )?;
        }
        if let Some(code) = &self.failure_code {
            identifier(code, 128)?;
        }
        Ok(())
    }

    pub(super) fn validate_against(&self, request: &ExecutionRequest) -> Result<()> {
        self.validate_metadata()?;
        ensure!(
            self.scope == request.scope,
            "sandbox execution scope substitution denied"
        );
        ensure!(
            self.request_key == request.request_key,
            "sandbox execution identity substitution denied"
        );
        ensure!(
            self.profile_ref == request.profile_ref && self.dataset_ids == request.dataset_ids,
            "sandbox execution input substitution denied"
        );
        ensure!(
            self.program_hash == format!("{:x}", Sha256::digest(request.program.as_bytes())),
            "sandbox execution program substitution denied"
        );
        // Output is deliberately not turned into ToolOutput here. The
        // controller's disclosure validator and current answer-admission
        // service own the subsequent release boundary.
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ExecutionEnvelope {
    pub execution: ExecutionSnapshot,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    pub(super) fn scope() -> SandboxScope {
        SandboxScope {
            actor_identity: "actor-a".into(),
            organization_id: "1".into(),
            company_id: "2".into(),
            run_id: "3".into(),
            policy_generation: "a".repeat(64),
        }
    }

    #[test]
    fn scope_denies_noncanonical_and_overflow_ids() {
        for id in ["0", "01", "1.0", "-1", "18446744073709551616"] {
            let mut value = scope();
            value.organization_id = id.into();
            assert!(value.validate().is_err(), "accepted {id}");
        }
        assert!(scope().validate().is_ok());
        let mut large = scope();
        large.organization_id = u64::MAX.to_string();
        assert!(large.validate().is_ok());
    }

    #[test]
    fn schema_denies_extra_fields_and_wrong_types() {
        let schema = DatasetSchema {
            schema_ref: "finance-v1".into(),
            fields: vec![DatasetField {
                name: "amount".into(),
                kind: DatasetFieldType::Number,
                nullable: false,
            }],
        };
        assert!(schema.validate_rows(&[json!({"amount":42})]).is_ok());
        assert!(schema
            .validate_rows(&[json!({"amount":42,"secret":"private"})])
            .is_err());
        assert!(schema.validate_rows(&[json!({"amount":"42"})]).is_err());
        assert!(schema.validate_rows(&[json!({"amount":null})]).is_err());
        assert!(schema
            .validate_rows(&[json!({"amount":9_007_199_254_740_992_u64})])
            .is_err());
        assert_eq!(
            schema
                .project_rows(&[json!({"amount":42,"secret":"excluded"})])
                .unwrap(),
            vec![json!({"amount":42})]
        );
    }

    #[test]
    fn handle_cannot_carry_rows_urls_or_credentials() {
        let handle = json!({"id":format!("ds_{}", "a".repeat(32)),"schemaRef":"finance-v1","rowCount":1,"expiresAt":"2026-10-28T23:00:00Z","sourceCapabilities":["finance.read"]});
        assert!(serde_json::from_value::<DatasetHandle>(handle.clone()).is_ok());
        for field in ["rows", "url", "credentials", "scope", "storagePath"] {
            let mut altered = handle.clone();
            altered[field] = json!("forbidden");
            assert!(serde_json::from_value::<DatasetHandle>(altered).is_err());
        }
    }

    #[test]
    fn execution_identity_binds_program_scope_and_profile() {
        let ids = vec![format!("ds_{}", "b".repeat(32))];
        let first =
            ExecutionRequest::new(scope(), "1 + 1".into(), ids.clone(), "js-v1".into()).unwrap();
        let same =
            ExecutionRequest::new(scope(), "1 + 1".into(), ids.clone(), "js-v1".into()).unwrap();
        let changed =
            ExecutionRequest::new(scope(), "1 + 2".into(), ids.clone(), "js-v1".into()).unwrap();
        let other_profile =
            ExecutionRequest::new(scope(), "1 + 1".into(), ids.clone(), "js-v2".into()).unwrap();
        let mut other_scope = scope();
        other_scope.run_id = "4".into();
        let other_run =
            ExecutionRequest::new(other_scope, "1 + 1".into(), ids, "js-v1".into()).unwrap();
        assert_eq!(first.request_key, same.request_key);
        assert_ne!(first.request_key, changed.request_key);
        assert_ne!(first.request_key, other_profile.request_key);
        assert_ne!(first.request_key, other_run.request_key);
        let a = format!("ds_{}", "a".repeat(32));
        let b = format!("ds_{}", "b".repeat(32));
        let ordered = ExecutionRequest::new(
            scope(),
            "1 + 1".into(),
            vec![a.clone(), b.clone()],
            "js-v1".into(),
        )
        .unwrap();
        let reversed =
            ExecutionRequest::new(scope(), "1 + 1".into(), vec![b, a], "js-v1".into()).unwrap();
        assert_eq!(ordered.request_key, reversed.request_key);
    }

    #[test]
    fn output_requires_completed_cleanup_and_own_dataset_sources() {
        let id = format!("ds_{}", "a".repeat(32));
        let base = json!({
            "requestKey":"a".repeat(64),"programHash":"b".repeat(64),
            "scope":scope(),"profileRef":"js-v1","datasetIds":[id],
            "createdAt":"2026-10-28T12:00:00Z","updatedAt":"2026-10-28T12:00:01Z",
            "status":"completed","evidence":[{"kind":"aggregate","value":{"label":"total","value":42,"count":3},"sourceDatasets":[id]}]
        });
        assert!(serde_json::from_value::<ExecutionSnapshot>(base.clone())
            .unwrap()
            .validate_metadata()
            .is_ok());
        let mut waiting = base.clone();
        waiting["status"] = json!("cleanup_pending");
        assert!(serde_json::from_value::<ExecutionSnapshot>(waiting)
            .unwrap()
            .validate_metadata()
            .is_err());
        let mut foreign = base.clone();
        foreign["evidence"][0]["sourceDatasets"] = json!([format!("ds_{}", "f".repeat(32))]);
        assert!(serde_json::from_value::<ExecutionSnapshot>(foreign)
            .unwrap()
            .validate_metadata()
            .is_err());
        let mut row_dump = base;
        row_dump["evidence"][0]["value"] =
            json!({"label":"total","value":42,"count":3,"rawRows":["private"]});
        assert!(serde_json::from_value::<ExecutionSnapshot>(row_dump)
            .unwrap()
            .validate_metadata()
            .is_err());
    }

    #[test]
    fn artifacts_require_matching_hash_and_same_disclosure_schema() {
        let id = format!("ds_{}", "a".repeat(32));
        let content = r#"{"kind":"aggregate","value":{"label":"total","value":42,"count":3}}"#;
        let mut receipt = json!({
            "requestKey":"a".repeat(64),"programHash":"b".repeat(64),
            "scope":scope(),"profileRef":"js-v1","datasetIds":[id],
            "createdAt":"2026-10-28T12:00:00Z","updatedAt":"2026-10-28T12:00:01Z",
            "status":"completed","artifacts":[{"name":"report.json","mimeType":"application/json","content":content,"sourceDatasets":[id],"sha256":format!("{:x}", Sha256::digest(content.as_bytes())),"bytes":content.len()}]
        });
        assert!(serde_json::from_value::<ExecutionSnapshot>(receipt.clone())
            .unwrap()
            .validate_metadata()
            .is_ok());
        receipt["artifacts"][0]["sha256"] = json!("f".repeat(64));
        assert!(serde_json::from_value::<ExecutionSnapshot>(receipt)
            .unwrap()
            .validate_metadata()
            .is_err());
    }
}
