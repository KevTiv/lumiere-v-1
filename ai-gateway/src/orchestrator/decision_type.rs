//! GP-07 (governed intelligence program): DecisionType registry.
//!
//! Every AI-backed judgment should reference a versioned
//! `DecisionTypeDefinition` (architecture §6): input/output schema,
//! required evidence, risk class, precedent policy, verification policy,
//! escalation policy. Provider prompts/wire formats are adapters around
//! these stable organizational semantics, not the other way around.
//!
//! This module binds GP-01's `DecisionRequest`/`DecisionResponse` and
//! GP-06's `PrecedentPolicy` to a versioned definition and computes what a
//! response owes the rest of the governed runtime: whether it requires
//! verification (GP-03's `VerificationService`) and whether it must
//! escalate (GP-05's `escalation_status`). It does not itself verify,
//! escalate, or execute anything — those remain the shared services' job.
//!
//! Input/output schema validation here is a **deliberate simplification**,
//! consistent with GP-03's shape-only placeholders: a structural
//! field-presence/type checker (`StructuralSchema`), not a full JSON
//! Schema draft implementation. No `jsonschema`/`schemars` dependency
//! exists in this crate; adding one is a separate decision, not a
//! prerequisite for binding cases to a decision type/version.
//!
//! Registry storage is in-memory here, same posture as every prior GP
//! step: production wiring binds this to a durable, versioned STDB table
//! (`spacetimedb/src/ai/decision_type_registry.rs`) once client bindings
//! are regenerated.

use std::collections::HashMap;
use std::sync::RwLock;

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use serde_json::Value;

use super::intelligence::{DecisionKind, DecisionRequest, DecisionResponse, DecisionTypeRef};
use super::precedent::{DecisionCaseStatus, PrecedentPolicy};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum RiskClass {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FieldKind {
    String,
    Number,
    Boolean,
    Object,
    Array,
}

impl FieldKind {
    fn matches(self, value: &Value) -> bool {
        match self {
            FieldKind::String => value.is_string(),
            FieldKind::Number => value.is_number(),
            FieldKind::Boolean => value.is_boolean(),
            FieldKind::Object => value.is_object(),
            FieldKind::Array => value.is_array(),
        }
    }

    fn label(self) -> &'static str {
        match self {
            FieldKind::String => "string",
            FieldKind::Number => "number",
            FieldKind::Boolean => "boolean",
            FieldKind::Object => "object",
            FieldKind::Array => "array",
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct FieldSchema {
    pub name: String,
    pub kind: FieldKind,
    pub required: bool,
}

impl FieldSchema {
    pub fn required(name: impl Into<String>, kind: FieldKind) -> Self {
        Self {
            name: name.into(),
            kind,
            required: true,
        }
    }

    pub fn optional(name: impl Into<String>, kind: FieldKind) -> Self {
        Self {
            name: name.into(),
            kind,
            required: false,
        }
    }
}

/// See module docs: structural field presence/type checking, not full JSON
/// Schema.
#[derive(Clone, Debug, Default)]
pub(super) struct StructuralSchema {
    pub fields: Vec<FieldSchema>,
}

impl StructuralSchema {
    pub fn validate(&self, value: &Value) -> Result<()> {
        let object = value
            .as_object()
            .context("value must be a JSON object to validate against a structural schema")?;
        for field in &self.fields {
            match object.get(&field.name) {
                Some(found) if !field.kind.matches(found) => {
                    bail!(
                        "field '{}' must be of kind {}",
                        field.name,
                        field.kind.label()
                    );
                }
                None if field.required => {
                    bail!("missing required field '{}'", field.name);
                }
                _ => {}
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub(super) struct VerificationPolicy {
    pub required: bool,
}

#[derive(Clone, Debug, Default)]
pub(super) struct EscalationPolicy {
    /// Escalate when provider confidence is present and below this
    /// threshold. Absent confidence never triggers this rule on its own —
    /// see `should_escalate`.
    pub min_confidence: Option<f64>,
    /// Risk classes that always require escalation regardless of
    /// confidence.
    pub always_escalate_risk_classes: Vec<RiskClass>,
}

impl EscalationPolicy {
    pub fn should_escalate(&self, risk_class: RiskClass, confidence: Option<f64>) -> bool {
        if self.always_escalate_risk_classes.contains(&risk_class) {
            return true;
        }
        match (self.min_confidence, confidence) {
            (Some(min), Some(actual)) => actual < min,
            // No confidence reported and the policy has a floor: treat
            // missing confidence as not meeting it, since it cannot be
            // shown to meet a threshold it never reported against.
            (Some(_), None) => true,
            (None, _) => false,
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct DecisionTypeDefinition {
    pub decision_type: DecisionTypeRef,
    pub description: String,
    pub kind: DecisionKind,
    pub input_schema: StructuralSchema,
    pub output_schema: StructuralSchema,
    pub required_evidence_kinds: Vec<String>,
    pub risk_class: RiskClass,
    pub precedent_policy: PrecedentPolicy,
    pub verification_policy: VerificationPolicy,
    pub escalation_policy: EscalationPolicy,
}

impl DecisionTypeDefinition {
    pub fn validate(&self) -> Result<()> {
        self.decision_type.validate()?;
        if self.description.trim().is_empty() {
            bail!("decision type definition description must be nonempty");
        }
        self.precedent_policy.validate()?;
        Ok(())
    }
}

/// Provider-neutral, versioned registry of `DecisionTypeDefinition`s. A
/// version, once registered, is immutable — publish a new version to
/// change one (same posture as GP-05/GP-06's append-only records).
#[async_trait]
pub(super) trait DecisionTypeRegistry: Send + Sync {
    async fn get(&self, name: &str, version: u32) -> Result<Option<DecisionTypeDefinition>>;
    async fn latest(&self, name: &str) -> Result<Option<DecisionTypeDefinition>>;
    async fn register(&self, definition: DecisionTypeDefinition) -> Result<()>;
}

/// Reference implementation for tests. Production wiring binds to the
/// durable STDB table instead (see module docs).
pub(super) struct InMemoryDecisionTypeRegistry {
    definitions: RwLock<HashMap<(String, u32), DecisionTypeDefinition>>,
    latest_version: RwLock<HashMap<String, u32>>,
}

impl InMemoryDecisionTypeRegistry {
    pub fn new() -> Self {
        Self {
            definitions: RwLock::new(HashMap::new()),
            latest_version: RwLock::new(HashMap::new()),
        }
    }

    /// Seeds a small starter catalog matching the architecture doc's named
    /// examples (§6). Not exhaustive — additional decision types register
    /// the same way at runtime.
    pub fn with_builtins() -> Self {
        let registry = Self::new();
        for definition in builtin_definitions() {
            registry
                .register_sync(definition)
                .expect("builtin decision type definitions must be internally valid");
        }
        registry
    }

    fn register_sync(&self, definition: DecisionTypeDefinition) -> Result<()> {
        definition.validate()?;
        let key = (
            definition.decision_type.name.clone(),
            definition.decision_type.version,
        );
        let mut definitions = self.definitions.write().unwrap();
        if let Some(existing) = definitions.get(&key) {
            if definitions_equal(existing, &definition) {
                return Ok(());
            }
            bail!(
                "decision type '{}' v{} is already registered with different content",
                key.0,
                key.1
            );
        }
        let mut latest = self.latest_version.write().unwrap();
        let is_newer = latest
            .get(&key.0)
            .map(|current| key.1 > *current)
            .unwrap_or(true);
        if is_newer {
            latest.insert(key.0.clone(), key.1);
        }
        definitions.insert(key, definition);
        Ok(())
    }
}

impl Default for InMemoryDecisionTypeRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl DecisionTypeRegistry for InMemoryDecisionTypeRegistry {
    async fn get(&self, name: &str, version: u32) -> Result<Option<DecisionTypeDefinition>> {
        Ok(self
            .definitions
            .read()
            .unwrap()
            .get(&(name.to_string(), version))
            .cloned())
    }

    async fn latest(&self, name: &str) -> Result<Option<DecisionTypeDefinition>> {
        let Some(version) = self.latest_version.read().unwrap().get(name).copied() else {
            return Ok(None);
        };
        self.get(name, version).await
    }

    async fn register(&self, definition: DecisionTypeDefinition) -> Result<()> {
        self.register_sync(definition)
    }
}

/// Field-by-field comparison sufficient to detect a genuine re-registration
/// conflict versus an idempotent replay. `StructuralSchema`/policy structs
/// intentionally do not derive `PartialEq` (their content is closures-free
/// but comparing `Vec<FieldSchema>` structurally is exactly what this
/// function does explicitly, rather than growing derives no other code needs).
fn definitions_equal(a: &DecisionTypeDefinition, b: &DecisionTypeDefinition) -> bool {
    a.decision_type.name == b.decision_type.name
        && a.decision_type.version == b.decision_type.version
        && a.description == b.description
        && a.kind == b.kind
        && a.risk_class == b.risk_class
        && a.required_evidence_kinds == b.required_evidence_kinds
        && schemas_equal(&a.input_schema, &b.input_schema)
        && schemas_equal(&a.output_schema, &b.output_schema)
}

fn schemas_equal(a: &StructuralSchema, b: &StructuralSchema) -> bool {
    a.fields.len() == b.fields.len()
        && a.fields
            .iter()
            .zip(b.fields.iter())
            .all(|(x, y)| x.name == y.name && x.kind == y.kind && x.required == y.required)
}

/// What a decision response owes the rest of the governed runtime, per its
/// definition. Computed here, enforced by `GovernedCapabilityService`/
/// `VerificationService`/GP-05's event fields — this function only decides,
/// it does not itself gate anything.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct DecisionAdmission {
    pub verification_required: bool,
    pub escalation_required: bool,
    pub escalation_reason: Option<String>,
}

/// Binds a request/response pair to its definition: type/version/kind
/// match, input schema, required evidence, and computes verification/
/// escalation requirements. Does not itself validate `response` against
/// `request` beyond kind — `DecisionResponse::validate_against` (GP-01)
/// remains the source of truth for that and should run first.
pub(super) fn admit_decision(
    definition: &DecisionTypeDefinition,
    request: &DecisionRequest,
    response: &DecisionResponse,
) -> Result<DecisionAdmission> {
    if request.decision_type.name != definition.decision_type.name
        || request.decision_type.version != definition.decision_type.version
    {
        bail!("decision request does not match the definition's type/version");
    }
    if request.kind != definition.kind {
        bail!("decision request kind does not match the definition's kind");
    }
    definition
        .input_schema
        .validate(&request.bounded_state)
        .context("decision request bounded_state failed input schema validation")?;
    for required_kind in &definition.required_evidence_kinds {
        if !request.evidence.iter().any(|e| &e.kind == required_kind) {
            bail!("decision request is missing required evidence kind '{required_kind}'");
        }
    }
    if response.kind != definition.kind {
        bail!("decision response kind does not match the definition's kind");
    }

    let escalation_required = definition
        .escalation_policy
        .should_escalate(definition.risk_class, response.confidence);
    let escalation_reason = escalation_required.then(|| {
        if definition
            .escalation_policy
            .always_escalate_risk_classes
            .contains(&definition.risk_class)
        {
            format!(
                "risk class {:?} always requires escalation",
                definition.risk_class
            )
        } else {
            format!(
                "confidence {:?} is below the required minimum {:?}",
                response.confidence, definition.escalation_policy.min_confidence
            )
        }
    });

    Ok(DecisionAdmission {
        verification_required: definition.verification_policy.required,
        escalation_required,
        escalation_reason,
    })
}

/// Starter catalog matching architecture §6's named examples. Not
/// exhaustive; each is a reasonable, illustrative default, not a fixed
/// business rule — organizations register/override their own.
fn builtin_definitions() -> Vec<DecisionTypeDefinition> {
    vec![
        DecisionTypeDefinition {
            decision_type: DecisionTypeRef {
                name: "PaymentDisposition".to_string(),
                version: 1,
            },
            description: "Flag or clear a payment for further review.".to_string(),
            kind: DecisionKind::Choice,
            input_schema: StructuralSchema {
                fields: vec![
                    FieldSchema::required("amount", FieldKind::Number),
                    FieldSchema::optional("payer_risk_notes", FieldKind::String),
                ],
            },
            output_schema: StructuralSchema::default(),
            required_evidence_kinds: vec!["erp_record".to_string()],
            risk_class: RiskClass::High,
            precedent_policy: PrecedentPolicy {
                enabled: true,
                max_cases: 5,
                minimum_status: DecisionCaseStatus::Reviewed,
                require_same_program_step: false,
                include_patterns: true,
            },
            verification_policy: VerificationPolicy { required: true },
            escalation_policy: EscalationPolicy {
                min_confidence: Some(0.6),
                always_escalate_risk_classes: vec![RiskClass::Critical],
            },
        },
        DecisionTypeDefinition {
            decision_type: DecisionTypeRef {
                name: "StockReorderPriority".to_string(),
                version: 1,
            },
            description: "Rank the urgency of reordering a low-stock item.".to_string(),
            kind: DecisionKind::Probability,
            input_schema: StructuralSchema {
                fields: vec![
                    FieldSchema::required("sku", FieldKind::String),
                    FieldSchema::optional("warehouse", FieldKind::String),
                ],
            },
            output_schema: StructuralSchema::default(),
            required_evidence_kinds: vec![],
            risk_class: RiskClass::Medium,
            precedent_policy: PrecedentPolicy {
                enabled: true,
                max_cases: 10,
                minimum_status: DecisionCaseStatus::Verified,
                require_same_program_step: false,
                include_patterns: true,
            },
            verification_policy: VerificationPolicy { required: false },
            escalation_policy: EscalationPolicy {
                min_confidence: Some(0.4),
                always_escalate_risk_classes: vec![],
            },
        },
        DecisionTypeDefinition {
            decision_type: DecisionTypeRef {
                name: "FraudConcern".to_string(),
                version: 1,
            },
            description: "Estimate the probability a transaction is fraudulent.".to_string(),
            kind: DecisionKind::Probability,
            input_schema: StructuralSchema {
                fields: vec![FieldSchema::required("transaction_id", FieldKind::String)],
            },
            output_schema: StructuralSchema::default(),
            required_evidence_kinds: vec!["erp_record".to_string()],
            risk_class: RiskClass::Critical,
            precedent_policy: PrecedentPolicy {
                enabled: true,
                max_cases: 5,
                minimum_status: DecisionCaseStatus::Approved,
                require_same_program_step: true,
                include_patterns: true,
            },
            verification_policy: VerificationPolicy { required: true },
            escalation_policy: EscalationPolicy {
                min_confidence: None,
                always_escalate_risk_classes: vec![RiskClass::Critical],
            },
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn choice_definition() -> DecisionTypeDefinition {
        DecisionTypeDefinition {
            decision_type: DecisionTypeRef {
                name: "PaymentDisposition".to_string(),
                version: 1,
            },
            description: "test".to_string(),
            kind: DecisionKind::Choice,
            input_schema: StructuralSchema {
                fields: vec![FieldSchema::required("amount", FieldKind::Number)],
            },
            output_schema: StructuralSchema::default(),
            required_evidence_kinds: vec!["erp_record".to_string()],
            risk_class: RiskClass::High,
            precedent_policy: PrecedentPolicy {
                enabled: true,
                max_cases: 5,
                minimum_status: DecisionCaseStatus::Reviewed,
                require_same_program_step: false,
                include_patterns: false,
            },
            verification_policy: VerificationPolicy { required: true },
            escalation_policy: EscalationPolicy {
                min_confidence: Some(0.6),
                always_escalate_risk_classes: vec![],
            },
        }
    }

    fn request(decision_type: DecisionTypeRef, bounded_state: Value) -> DecisionRequest {
        DecisionRequest {
            decision_type,
            kind: DecisionKind::Choice,
            question: "flag or clear?".to_string(),
            bounded_state,
            candidates: vec!["flag".to_string(), "clear".to_string()],
            precedent: vec![],
            evidence: vec![super::super::intelligence::EvidenceRef {
                kind: "erp_record".to_string(),
                id: "PO-1".to_string(),
            }],
        }
    }

    fn response(confidence: Option<f64>) -> DecisionResponse {
        DecisionResponse {
            kind: DecisionKind::Choice,
            choice: Some("flag".to_string()),
            score: None,
            probability: None,
            confidence,
            rationale: None,
            model: "mistral-large-latest".to_string(),
            provider: "mistral".to_string(),
            input_tokens: 10,
            output_tokens: 5,
        }
    }

    #[test]
    fn structural_schema_rejects_missing_required_field() {
        let schema = StructuralSchema {
            fields: vec![FieldSchema::required("amount", FieldKind::Number)],
        };
        assert!(schema.validate(&json!({})).is_err());
        assert!(schema.validate(&json!({"amount": 100})).is_ok());
    }

    #[test]
    fn structural_schema_rejects_wrong_type() {
        let schema = StructuralSchema {
            fields: vec![FieldSchema::required("amount", FieldKind::Number)],
        };
        assert!(schema.validate(&json!({"amount": "100"})).is_err());
    }

    #[test]
    fn structural_schema_allows_missing_optional_field() {
        let schema = StructuralSchema {
            fields: vec![FieldSchema::optional("note", FieldKind::String)],
        };
        assert!(schema.validate(&json!({})).is_ok());
    }

    #[tokio::test]
    async fn registry_round_trips_and_is_immutable_per_version() {
        let registry = InMemoryDecisionTypeRegistry::new();
        let def = choice_definition();
        registry.register(def.clone()).await.unwrap();

        let fetched = registry
            .get("PaymentDisposition", 1)
            .await
            .unwrap()
            .expect("definition should be registered");
        assert_eq!(fetched.risk_class, RiskClass::High);

        let mut conflicting = def.clone();
        conflicting.description = "different".to_string();
        assert!(registry.register(conflicting).await.is_err());

        // Identical re-registration is idempotent.
        assert!(registry.register(def).await.is_ok());
    }

    #[tokio::test]
    async fn latest_tracks_highest_registered_version() {
        let registry = InMemoryDecisionTypeRegistry::new();
        let v1 = choice_definition();
        registry.register(v1).await.unwrap();
        let mut v2 = choice_definition();
        v2.decision_type.version = 2;
        registry.register(v2).await.unwrap();

        let latest = registry
            .latest("PaymentDisposition")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(latest.decision_type.version, 2);
    }

    #[tokio::test]
    async fn registering_an_older_version_after_a_newer_one_does_not_move_latest_backwards() {
        let registry = InMemoryDecisionTypeRegistry::new();
        let mut v2 = choice_definition();
        v2.decision_type.version = 2;
        registry.register(v2).await.unwrap();
        let v1 = choice_definition();
        registry.register(v1).await.unwrap();

        let latest = registry
            .latest("PaymentDisposition")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(latest.decision_type.version, 2);
    }

    #[test]
    fn admit_decision_rejects_type_mismatch() {
        let def = choice_definition();
        let wrong_type = DecisionTypeRef {
            name: "Other".to_string(),
            version: 1,
        };
        let req = request(wrong_type, json!({"amount": 100}));
        let resp = response(Some(0.9));
        assert!(admit_decision(&def, &req, &resp).is_err());
    }

    #[test]
    fn admit_decision_rejects_missing_required_evidence() {
        let def = choice_definition();
        let mut req = request(def.decision_type.clone(), json!({"amount": 100}));
        req.evidence.clear();
        let resp = response(Some(0.9));
        assert!(admit_decision(&def, &req, &resp).is_err());
    }

    #[test]
    fn admit_decision_rejects_bad_input_shape() {
        let def = choice_definition();
        let req = request(def.decision_type.clone(), json!({"wrong_field": 1}));
        let resp = response(Some(0.9));
        assert!(admit_decision(&def, &req, &resp).is_err());
    }

    #[test]
    fn admit_decision_requires_escalation_below_confidence_floor() {
        let def = choice_definition();
        let req = request(def.decision_type.clone(), json!({"amount": 100}));
        let low_confidence = response(Some(0.2));
        let admission = admit_decision(&def, &req, &low_confidence).unwrap();
        assert!(admission.escalation_required);
        assert!(admission.escalation_reason.is_some());

        let high_confidence = response(Some(0.9));
        let admission = admit_decision(&def, &req, &high_confidence).unwrap();
        assert!(!admission.escalation_required);
    }

    #[test]
    fn admit_decision_treats_missing_confidence_as_below_floor() {
        let def = choice_definition();
        let req = request(def.decision_type.clone(), json!({"amount": 100}));
        let no_confidence = response(None);
        let admission = admit_decision(&def, &req, &no_confidence).unwrap();
        assert!(admission.escalation_required);
    }

    #[test]
    fn admit_decision_always_escalates_critical_risk_regardless_of_confidence() {
        let mut def = choice_definition();
        def.risk_class = RiskClass::Critical;
        def.escalation_policy = EscalationPolicy {
            min_confidence: None,
            always_escalate_risk_classes: vec![RiskClass::Critical],
        };
        let req = request(def.decision_type.clone(), json!({"amount": 100}));
        let resp = response(Some(0.99));
        let admission = admit_decision(&def, &req, &resp).unwrap();
        assert!(admission.escalation_required);
    }

    #[test]
    fn admit_decision_reports_verification_requirement_from_definition() {
        let def = choice_definition();
        let req = request(def.decision_type.clone(), json!({"amount": 100}));
        let resp = response(Some(0.9));
        let admission = admit_decision(&def, &req, &resp).unwrap();
        assert!(admission.verification_required);
    }

    #[tokio::test]
    async fn builtin_registry_seeds_named_examples() {
        let registry = InMemoryDecisionTypeRegistry::with_builtins();
        assert!(registry
            .get("PaymentDisposition", 1)
            .await
            .unwrap()
            .is_some());
        assert!(registry
            .get("StockReorderPriority", 1)
            .await
            .unwrap()
            .is_some());
        assert!(registry.get("FraudConcern", 1).await.unwrap().is_some());
        assert!(registry.get("NoSuchType", 1).await.unwrap().is_none());
    }
}
