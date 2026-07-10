use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

use super::manifest::{ExecutionLimits, RiskClass, SkillVersionRef};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DecisionOutcome {
    Allow,
    DraftOnly,
    Deny,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyReasonCode {
    Allowed,
    DraftOnly,
    InvalidContext,
    UnknownSkillVersion,
    VersionNotPromoted,
    InvalidManifest,
    NamedResourceRequired,
    ResourceNotAllowed,
    UnknownResource,
    ResourceNotPromoted,
    OutputContractMismatch,
    CapabilityDenied,
    ToolDenied,
    RowLimitExceeded,
    StepLimitExceeded,
    ToolCallLimitExceeded,
    OutputTypeMismatch,
    InvalidInput,
    InvalidOutput,
    RedApprovalRequired,
    CrossCompanyRow,
    PrivacyViolation,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DecisionReason {
    pub code: PolicyReasonCode,
    pub message: String,
}

impl DecisionReason {
    pub fn new(code: PolicyReasonCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CorrelationMetadata {
    pub correlation_id: String,
    pub organization_id: u64,
    pub company_id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DecisionHashes {
    pub request_hash: String,
    pub input_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest_hash: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PolicyDecision {
    pub outcome: DecisionOutcome,
    pub skill: SkillVersionRef,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub risk: Option<RiskClass>,
    pub reasons: Vec<DecisionReason>,
    pub correlation: CorrelationMetadata,
    pub hashes: DecisionHashes,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enforced_limits: Option<ExecutionLimits>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct PrivacyReport {
    pub rows_processed: u32,
    pub masked_fields: Vec<String>,
    pub suppressed_fields: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct PolicyResult {
    pub decision: PolicyDecision,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub privacy: Option<PrivacyReport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_hash: Option<String>,
    pub result_hash: String,
}

impl PolicyResult {
    pub fn new(
        decision: PolicyDecision,
        output: Option<Value>,
        privacy: Option<PrivacyReport>,
    ) -> Self {
        let output_hash = output.as_ref().map(hash_value);
        let mut result = Self {
            decision,
            output,
            privacy,
            output_hash,
            result_hash: String::new(),
        };
        result.result_hash = hash_serializable(&result);
        result
    }
}

pub fn hash_serializable<T: Serialize>(value: &T) -> String {
    let value = serde_json::to_value(value).unwrap_or(Value::Null);
    hash_value(&value)
}

pub fn hash_value(value: &Value) -> String {
    let canonical = canonicalize(value);
    let bytes = serde_json::to_vec(&canonical).unwrap_or_else(|_| b"null".to_vec());
    format!("uuid-v5:{}", Uuid::new_v5(&Uuid::NAMESPACE_OID, &bytes))
}

fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut entries: Vec<_> = object.iter().collect();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));
            let mut canonical = Map::new();
            for (key, value) in entries {
                canonical.insert(key.clone(), canonicalize(value));
            }
            Value::Object(canonical)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonicalize).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_are_stable_across_object_key_order() {
        assert_eq!(
            hash_value(&serde_json::json!({"a": 1, "b": 2})),
            hash_value(&serde_json::json!({"b": 2, "a": 1}))
        );
    }
}
