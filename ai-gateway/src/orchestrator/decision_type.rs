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
//! The in-memory registry remains for unit tests. Production callers use
//! `StdbDecisionTypeRegistry`, which binds this contract to the durable,
//! versioned STDB `ai_decision_type_definition` table.

use std::collections::HashMap;
use std::sync::RwLock;

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use serde_json::{json, Value};
use stdb_client::{ReducerCall, StdbClient};

use super::graduation::GraduationPolicy;
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
    /// Optional GP-16 eligibility policy. Kept inside the existing immutable
    /// DecisionType policy JSON envelope so graduation does not create a
    /// second configuration subsystem.
    pub graduation_policy: Option<GraduationPolicy>,
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
        if let Some(policy) = &self.graduation_policy {
            policy.validate()?;
        }
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

pub(super) struct StdbDecisionTypeRegistry<'a> {
    pub writer: &'a StdbClient,
    pub reader: &'a StdbClient,
    pub organization_id: u64,
}

impl StdbDecisionTypeRegistry<'_> {
    async fn query_one(&self, sql: &str) -> Result<Option<DecisionTypeDefinition>> {
        let rows = self
            .reader
            .query_sql(sql)
            .await
            .context("query durable decision type registry")?;
        rows.first().map(decode_definition).transpose()
    }
}

#[async_trait]
impl DecisionTypeRegistry for StdbDecisionTypeRegistry<'_> {
    async fn get(&self, name: &str, version: u32) -> Result<Option<DecisionTypeDefinition>> {
        if self.organization_id == 0 {
            bail!("organization_id must be nonzero");
        }
        let name = sql_escape(name);
        self.query_one(&format!(
            "SELECT * FROM ai_decision_type_definition \
             WHERE organization_id = {} AND decision_type_name = '{}' \
             AND decision_type_version = {} AND is_active = true LIMIT 1",
            self.organization_id, name, version
        ))
        .await
    }

    async fn latest(&self, name: &str) -> Result<Option<DecisionTypeDefinition>> {
        if self.organization_id == 0 {
            bail!("organization_id must be nonzero");
        }
        let name = sql_escape(name);
        self.query_one(&format!(
            "SELECT * FROM ai_decision_type_definition \
             WHERE organization_id = {} AND decision_type_name = '{}' \
             AND is_active = true ORDER BY decision_type_version DESC LIMIT 1",
            self.organization_id, name
        ))
        .await
    }

    async fn register(&self, definition: DecisionTypeDefinition) -> Result<()> {
        if self.organization_id == 0 {
            bail!("organization_id must be nonzero");
        }
        definition.validate()?;
        self.writer
            .call_reducer(ReducerCall::from_name("register_ai_decision_type", json!([
                    self.organization_id,
                    {
                        "decision_type_name": definition.decision_type.name,
                        "decision_type_version": definition.decision_type.version,
                        "description": definition.description,
                        "kind": decision_kind_label(definition.kind),
                        "input_schema_json": encode_structural_schema(&definition.input_schema).to_string(),
                        "output_schema_json": encode_structural_schema(&definition.output_schema).to_string(),
                        "required_evidence_kinds": definition.required_evidence_kinds,
                        "risk_class": risk_class_label(definition.risk_class),
                        "precedent_policy_json": encode_decision_policy_envelope(&definition.precedent_policy, definition.graduation_policy.as_ref()).to_string(),
                        "verification_required": definition.verification_policy.required,
                        "escalation_policy_json": encode_escalation_policy(&definition.escalation_policy).to_string(),
                    }
                ])))
            .await
            .context("register durable decision type")
    }
}

fn decode_definition(row: &Value) -> Result<DecisionTypeDefinition> {
    let kind = match row_string(row, "kind").as_deref() {
        Some("choice") => DecisionKind::Choice,
        Some("score") => DecisionKind::Score,
        Some("probability") => DecisionKind::Probability,
        Some(other) => bail!("unknown decision kind '{other}'"),
        None => bail!("decision kind is missing"),
    };
    let risk_class = match row_string(row, "riskClass").as_deref() {
        Some("low") => RiskClass::Low,
        Some("medium") => RiskClass::Medium,
        Some("high") => RiskClass::High,
        Some("critical") => RiskClass::Critical,
        Some(other) => bail!("unknown risk class '{other}'"),
        None => bail!("risk class is missing"),
    };
    let input_schema = decode_structural_schema(&parse_json_string(row, "inputSchemaJson")?)?;
    let output_schema = decode_structural_schema(&parse_json_string(row, "outputSchemaJson")?)?;
    let decision_policy_json = parse_json_string(row, "precedentPolicyJson")?;
    let precedent_policy = decode_precedent_policy(&decision_policy_json)?;
    let graduation_policy = decode_graduation_policy(&decision_policy_json)?;
    let escalation_policy =
        decode_escalation_policy(&parse_json_string(row, "escalationPolicyJson")?)?;
    let definition = DecisionTypeDefinition {
        decision_type: DecisionTypeRef {
            name: row_string(row, "decisionTypeName").unwrap_or_default(),
            version: row_u64(row, "decisionTypeVersion").unwrap_or_default() as u32,
        },
        description: row_string(row, "description").unwrap_or_default(),
        kind,
        input_schema,
        output_schema,
        required_evidence_kinds: row_string_list(row, "requiredEvidenceKinds"),
        risk_class,
        precedent_policy,
        graduation_policy,
        verification_policy: VerificationPolicy {
            required: row_bool(row, "verificationRequired").unwrap_or(false),
        },
        escalation_policy,
    };
    definition.validate()?;
    Ok(definition)
}

fn encode_structural_schema(schema: &StructuralSchema) -> Value {
    json!({
        "fields": schema.fields.iter().map(|field| json!({
            "name": field.name,
            "kind": field_kind_label(field.kind),
            "required": field.required,
        })).collect::<Vec<_>>()
    })
}

fn decode_structural_schema(value: &Value) -> Result<StructuralSchema> {
    let fields = value
        .get("fields")
        .and_then(Value::as_array)
        .context("structural schema must contain fields")?;
    let mut decoded = Vec::with_capacity(fields.len());
    for field in fields {
        let name = field
            .get("name")
            .and_then(Value::as_str)
            .context("structural schema field name is required")?
            .to_string();
        let kind = match field.get("kind").and_then(Value::as_str) {
            Some("string") => FieldKind::String,
            Some("number") => FieldKind::Number,
            Some("boolean") => FieldKind::Boolean,
            Some("object") => FieldKind::Object,
            Some("array") => FieldKind::Array,
            Some(other) => bail!("unknown structural field kind '{other}'"),
            None => bail!("structural schema field kind is required"),
        };
        decoded.push(FieldSchema {
            name,
            kind,
            required: field
                .get("required")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        });
    }
    Ok(StructuralSchema { fields: decoded })
}

fn encode_precedent_policy(policy: &PrecedentPolicy) -> Value {
    json!({
        "enabled": policy.enabled,
        "max_cases": policy.max_cases,
        "minimum_status": decision_case_status_label(policy.minimum_status),
        "require_same_program_step": policy.require_same_program_step,
        "include_patterns": policy.include_patterns,
    })
}

fn encode_decision_policy_envelope(
    precedent: &PrecedentPolicy,
    graduation: Option<&GraduationPolicy>,
) -> Value {
    let mut value = encode_precedent_policy(precedent);
    if let (Some(policy), Some(object)) = (graduation, value.as_object_mut()) {
        object.insert(
            "graduation".to_string(),
            serde_json::to_value(policy).expect("GraduationPolicy is serializable"),
        );
    }
    value
}

fn decode_graduation_policy(value: &Value) -> Result<Option<GraduationPolicy>> {
    let Some(graduation) = value.get("graduation") else {
        return Ok(None);
    };
    let policy: GraduationPolicy =
        serde_json::from_value(graduation.clone()).context("decode graduation policy")?;
    policy.validate()?;
    Ok(Some(policy))
}

fn decode_precedent_policy(value: &Value) -> Result<PrecedentPolicy> {
    let minimum_status = match value.get("minimum_status").and_then(Value::as_str) {
        Some("observed") => DecisionCaseStatus::Observed,
        Some("verified") => DecisionCaseStatus::Verified,
        Some("reviewed") => DecisionCaseStatus::Reviewed,
        Some("approved") => DecisionCaseStatus::Approved,
        Some("rejected") => DecisionCaseStatus::Rejected,
        Some("superseded") => DecisionCaseStatus::Superseded,
        Some(other) => bail!("unknown precedent minimum status '{other}'"),
        None => DecisionCaseStatus::Observed,
    };
    Ok(PrecedentPolicy {
        enabled: value
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        max_cases: value.get("max_cases").and_then(Value::as_u64).unwrap_or(5) as u32,
        minimum_status,
        require_same_program_step: value
            .get("require_same_program_step")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        include_patterns: value
            .get("include_patterns")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn encode_escalation_policy(policy: &EscalationPolicy) -> Value {
    json!({
        "min_confidence": policy.min_confidence,
        "always_escalate_risk_classes": policy
            .always_escalate_risk_classes
            .iter()
            .map(|risk| risk_class_label(*risk))
            .collect::<Vec<_>>(),
    })
}

fn decode_escalation_policy(value: &Value) -> Result<EscalationPolicy> {
    let mut always_escalate_risk_classes = Vec::new();
    for risk in value
        .get("always_escalate_risk_classes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let risk = match risk.as_str() {
            Some("low") => RiskClass::Low,
            Some("medium") => RiskClass::Medium,
            Some("high") => RiskClass::High,
            Some("critical") => RiskClass::Critical,
            Some(other) => bail!("unknown escalation risk class '{other}'"),
            None => bail!("escalation risk class must be a string"),
        };
        always_escalate_risk_classes.push(risk);
    }
    Ok(EscalationPolicy {
        min_confidence: value.get("min_confidence").and_then(Value::as_f64),
        always_escalate_risk_classes,
    })
}

fn parse_json_string(row: &Value, key: &str) -> Result<Value> {
    let raw = row_string(row, key).with_context(|| format!("missing JSON field '{key}'"))?;
    serde_json::from_str(&raw).with_context(|| format!("parse JSON field '{key}'"))
}

fn row_string(row: &Value, key: &str) -> Option<String> {
    let snake = camel_to_snake(key);
    row.get(key)
        .or_else(|| row.get(&snake))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn row_u64(row: &Value, key: &str) -> Option<u64> {
    let snake = camel_to_snake(key);
    row.get(key)
        .or_else(|| row.get(&snake))
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

fn row_bool(row: &Value, key: &str) -> Option<bool> {
    let snake = camel_to_snake(key);
    row.get(key)
        .or_else(|| row.get(&snake))
        .and_then(Value::as_bool)
}

fn row_string_list(row: &Value, key: &str) -> Vec<String> {
    let snake = camel_to_snake(key);
    row.get(key)
        .or_else(|| row.get(&snake))
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn camel_to_snake(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 4);
    for ch in value.chars() {
        if ch.is_ascii_uppercase() {
            out.push('_');
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn sql_escape(value: &str) -> String {
    value.replace('\'', "''")
}

fn decision_kind_label(kind: DecisionKind) -> &'static str {
    match kind {
        DecisionKind::Choice => "choice",
        DecisionKind::Score => "score",
        DecisionKind::Probability => "probability",
    }
}

fn risk_class_label(risk: RiskClass) -> &'static str {
    match risk {
        RiskClass::Low => "low",
        RiskClass::Medium => "medium",
        RiskClass::High => "high",
        RiskClass::Critical => "critical",
    }
}

fn field_kind_label(kind: FieldKind) -> &'static str {
    match kind {
        FieldKind::String => "string",
        FieldKind::Number => "number",
        FieldKind::Boolean => "boolean",
        FieldKind::Object => "object",
        FieldKind::Array => "array",
    }
}

fn decision_case_status_label(status: DecisionCaseStatus) -> &'static str {
    match status {
        DecisionCaseStatus::Observed => "observed",
        DecisionCaseStatus::Verified => "verified",
        DecisionCaseStatus::Reviewed => "reviewed",
        DecisionCaseStatus::Approved => "approved",
        DecisionCaseStatus::Rejected => "rejected",
        DecisionCaseStatus::Superseded => "superseded",
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
        && a.precedent_policy.enabled == b.precedent_policy.enabled
        && a.precedent_policy.max_cases == b.precedent_policy.max_cases
        && a.precedent_policy.minimum_status == b.precedent_policy.minimum_status
        && a.precedent_policy.require_same_program_step
            == b.precedent_policy.require_same_program_step
        && a.precedent_policy.include_patterns == b.precedent_policy.include_patterns
        && a.graduation_policy == b.graduation_policy
        && a.verification_policy.required == b.verification_policy.required
        && a.escalation_policy.min_confidence == b.escalation_policy.min_confidence
        && a.escalation_policy.always_escalate_risk_classes
            == b.escalation_policy.always_escalate_risk_classes
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

    let deterministic = response.provider == "deterministic";
    let risk_escalation = definition
        .escalation_policy
        .always_escalate_risk_classes
        .contains(&definition.risk_class);
    let confidence_escalation = !deterministic
        && definition
            .escalation_policy
            .should_escalate(definition.risk_class, response.confidence);
    let escalation_required = risk_escalation || confidence_escalation;
    let escalation_reason = escalation_required.then(|| {
        if risk_escalation {
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
pub(super) async fn register_builtin_decision_types(
    registry: &dyn DecisionTypeRegistry,
) -> Result<()> {
    for definition in builtin_definitions() {
        registry.register(definition).await?;
    }
    Ok(())
}

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
            graduation_policy: None,
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
            graduation_policy: None,
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
            graduation_policy: None,
            verification_policy: VerificationPolicy { required: true },
            escalation_policy: EscalationPolicy {
                min_confidence: None,
                always_escalate_risk_classes: vec![RiskClass::Critical],
            },
        },
        DecisionTypeDefinition {
            decision_type: DecisionTypeRef {
                name: "ReportAttentionNeed".to_string(),
                version: 1,
            },
            description:
                "Estimate whether an approved analytics summary warrants focused human follow-up."
                    .to_string(),
            kind: DecisionKind::Probability,
            input_schema: StructuralSchema {
                fields: vec![FieldSchema::required("data", FieldKind::Object)],
            },
            output_schema: StructuralSchema::default(),
            required_evidence_kinds: vec![],
            risk_class: RiskClass::Low,
            precedent_policy: PrecedentPolicy {
                enabled: true,
                max_cases: 10,
                minimum_status: DecisionCaseStatus::Verified,
                require_same_program_step: true,
                include_patterns: true,
            },
            graduation_policy: None,
            verification_policy: VerificationPolicy { required: false },
            escalation_policy: EscalationPolicy {
                min_confidence: Some(0.35),
                always_escalate_risk_classes: vec![],
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
            graduation_policy: None,
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
    fn graduation_policy_round_trips_inside_existing_decision_policy_envelope() {
        let mut policy = GraduationPolicy::disabled();
        policy.enabled = true;
        let precedent = choice_definition().precedent_policy;
        let encoded = encode_decision_policy_envelope(&precedent, Some(&policy));
        let decoded = decode_graduation_policy(&encoded).unwrap().unwrap();
        assert_eq!(decoded, policy);

        // Backward compatibility: existing v1 definitions do not gain a
        // graduation policy merely by being decoded by the new harness.
        let legacy = encode_precedent_policy(&precedent);
        assert!(decode_graduation_policy(&legacy).unwrap().is_none());
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

    #[test]
    fn deterministic_response_skips_model_confidence_floor_but_keeps_risk_escalation() {
        let mut definition = choice_definition();
        definition.escalation_policy.min_confidence = Some(0.9);

        let req = request(definition.decision_type.clone(), json!({"amount": 100}));
        let mut deterministic = response(None);
        deterministic.provider = "deterministic".to_string();
        deterministic.model = "deterministic:test@1".to_string();

        let admitted = admit_decision(&definition, &req, &deterministic).unwrap();
        assert!(!admitted.escalation_required);

        definition.risk_class = RiskClass::Critical;
        definition
            .escalation_policy
            .always_escalate_risk_classes
            .push(RiskClass::Critical);
        let admitted = admit_decision(&definition, &req, &deterministic).unwrap();
        assert!(admitted.escalation_required);
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
