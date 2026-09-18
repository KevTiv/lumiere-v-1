//! GP-07 (governed intelligence program): durable DecisionType registry.
//!
//! Companion to `ai-gateway/src/orchestrator/decision_type.rs`, which owns
//! the actual schema-validation and escalation/verification logic. This
//! table is only the durable, versioned catalog: input/output schema and
//! policy fields are stored as opaque JSON, the same "durable evidence, not
//! a second schema to keep in sync" posture as `decision_events.rs` (GP-05).
//!
//! A version, once registered, is immutable — `register_ai_decision_type`
//! is idempotent on an identical replay and rejects a differing one, same
//! contract as every other GP table. `organization_id = 0` is a
//! system-wide definition available to all organizations, following
//! `AiSkill`'s existing convention (`ai/skills.rs`).
//!
//! Additive only: no reducer here is called by production code yet.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::check_permission;

const MAX_JSON_FIELD_LEN: usize = 256_000;
const DECISION_KINDS: [&str; 3] = ["choice", "score", "probability"];
const RISK_CLASSES: [&str; 4] = ["low", "medium", "high", "critical"];

#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = ai_decision_type_definition,
    public,
    index(
        accessor = ai_decision_type_by_org,
        btree(columns = [organization_id])
    ),
    index(
        accessor = ai_decision_type_by_name,
        btree(columns = [organization_id, decision_type_name])
    )
)]
pub struct AiDecisionTypeDefinition {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// `0` = system-wide definition available to all organizations.
    pub organization_id: u64,
    pub decision_type_name: String,
    pub decision_type_version: u32,
    pub description: String,
    /// "choice" | "score" | "probability"
    pub kind: String,
    pub input_schema_json: String,
    pub output_schema_json: String,
    pub required_evidence_kinds: Vec<String>,
    /// "low" | "medium" | "high" | "critical"
    pub risk_class: String,
    pub precedent_policy_json: String,
    pub verification_required: bool,
    pub escalation_policy_json: String,
    pub is_active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RegisterAiDecisionTypeParams {
    pub decision_type_name: String,
    pub decision_type_version: u32,
    pub description: String,
    pub kind: String,
    pub input_schema_json: String,
    pub output_schema_json: String,
    pub required_evidence_kinds: Vec<String>,
    pub risk_class: String,
    pub precedent_policy_json: String,
    pub verification_required: bool,
    pub escalation_policy_json: String,
}

/// Register (or idempotently replay) one immutable decision type version.
/// `organization_id = 0` registers a system-wide definition; any other
/// value scopes it to that organization only.
#[reducer]
pub fn register_ai_decision_type(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RegisterAiDecisionTypeParams,
) -> Result<(), String> {
    check_permission(
        ctx,
        organization_id,
        "ai_decision_type_definition",
        "create",
    )?;

    if params.decision_type_name.trim().is_empty() {
        return Err("decision_type_name is required".to_string());
    }
    if params.decision_type_version == 0 {
        return Err("decision_type_version must be positive".to_string());
    }
    if params.description.trim().is_empty() {
        return Err("description is required".to_string());
    }
    if !DECISION_KINDS.contains(&params.kind.as_str()) {
        return Err(format!("kind must be one of {DECISION_KINDS:?}"));
    }
    if !RISK_CLASSES.contains(&params.risk_class.as_str()) {
        return Err(format!("risk_class must be one of {RISK_CLASSES:?}"));
    }
    for field in [
        &params.input_schema_json,
        &params.output_schema_json,
        &params.precedent_policy_json,
        &params.escalation_policy_json,
    ] {
        if field.len() > MAX_JSON_FIELD_LEN {
            return Err("a JSON field exceeds the size limit".to_string());
        }
    }

    if let Some(existing) = find_definition(
        ctx,
        organization_id,
        &params.decision_type_name,
        params.decision_type_version,
    ) {
        if definition_payload_matches(&existing, &params) {
            return Ok(());
        }
        return Err(format!(
            "decision type '{}' v{} is already registered with different content",
            params.decision_type_name, params.decision_type_version
        ));
    }

    ctx.db
        .ai_decision_type_definition()
        .insert(AiDecisionTypeDefinition {
            id: 0,
            organization_id,
            decision_type_name: params.decision_type_name,
            decision_type_version: params.decision_type_version,
            description: params.description,
            kind: params.kind,
            input_schema_json: params.input_schema_json,
            output_schema_json: params.output_schema_json,
            required_evidence_kinds: params.required_evidence_kinds,
            risk_class: params.risk_class,
            precedent_policy_json: params.precedent_policy_json,
            verification_required: params.verification_required,
            escalation_policy_json: params.escalation_policy_json,
            is_active: true,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });
    Ok(())
}

/// Deprecate or reactivate one registered version. Never rewrites the
/// immutable schema/policy fields — only whether it is currently usable.
#[reducer]
pub fn set_ai_decision_type_active(
    ctx: &ReducerContext,
    organization_id: u64,
    decision_type_name: String,
    decision_type_version: u32,
    is_active: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_decision_type_definition", "write")?;

    let definition = find_definition(
        ctx,
        organization_id,
        &decision_type_name,
        decision_type_version,
    )
    .ok_or("Decision type definition not found")?;
    ctx.db
        .ai_decision_type_definition()
        .id()
        .update(AiDecisionTypeDefinition {
            is_active,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..definition
        });
    Ok(())
}

fn find_definition(
    ctx: &ReducerContext,
    organization_id: u64,
    decision_type_name: &str,
    decision_type_version: u32,
) -> Option<AiDecisionTypeDefinition> {
    ctx.db
        .ai_decision_type_definition()
        .ai_decision_type_by_org()
        .filter(&organization_id)
        .find(|d| {
            d.decision_type_name == decision_type_name
                && d.decision_type_version == decision_type_version
        })
}

fn definition_payload_matches(
    existing: &AiDecisionTypeDefinition,
    params: &RegisterAiDecisionTypeParams,
) -> bool {
    existing.description == params.description
        && existing.kind == params.kind
        && existing.input_schema_json == params.input_schema_json
        && existing.output_schema_json == params.output_schema_json
        && existing.required_evidence_kinds == params.required_evidence_kinds
        && existing.risk_class == params.risk_class
        && existing.precedent_policy_json == params.precedent_policy_json
        && existing.verification_required == params.verification_required
        && existing.escalation_policy_json == params.escalation_policy_json
}
