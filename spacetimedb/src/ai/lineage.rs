//! AIH-14 — Discussion decisions and component lineage (M1).
//!
//! Persists typed claims/concepts, decisions, and versioned
//! artifact-component bindings. All three are tenant-scoped and
//! write-authorized; reads go through normal authorized SQL.
//! The chain `SourceVersion → SourcePassage → Claim → Decision → ArtifactComponent`
//! is the reconstruction authority after resume/edit/fork (§7.2). A bibliography
//! without component links does not satisfy the gate.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::provenance::{ai_source_passage, ai_source_version};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const MAX_KIND_LEN: usize = 32;
const MAX_HASH_LEN: usize = 128;
const MAX_TITLE_LEN: usize = 500;
const MAX_URI_LEN: usize = 2048;
/// SpacetimeDB auto-increment sentinel — not a business id.
const AUTO_INC_SENTINEL: u64 = 0;

// ── Tables ─────────────────────────────────────────────────────────────────

/// Typed claim or concept — a statement with explicit kind and supporting refs.
///
/// `kind`: `quotation` | `paraphrase` | `sourced_fact` | `calculation` |
/// `inference` | `recommendation`. Assumptions and verification outcome are
/// stored separately from the statement itself (§7.1).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_claim,
    index(accessor = ai_claim_by_org, btree(columns = [organization_id])),
    index(accessor = ai_claim_by_source_passage, btree(columns = [source_passage_id]))
)]
pub struct AiClaim {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub source_version_id: Option<u64>,
    pub source_passage_id: Option<u64>,
    pub kind: String,
    pub statement: String,
    pub assumptions_json: Option<String>,
    pub verification_outcome: Option<String>,
    /// `pending_review` | `verified` | `unresolved`
    pub status: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

/// Observable decision — adopted concept with applicability, alternatives,
/// adaptations, and bounded rationale. Not a hidden chain-of-thought.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_decision,
    index(accessor = ai_decision_by_org, btree(columns = [organization_id])),
    index(accessor = ai_decision_by_claim, btree(columns = [claim_id]))
)]
pub struct AiDecision {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub claim_id: Option<u64>,
    /// JSON array of supporting claim ids (explicit, not inferred).
    pub supporting_claims_json: Option<String>,
    /// JSON array of supporting source version ids.
    pub supporting_sources_json: Option<String>,
    pub applicability: Option<String>,
    pub alternatives_json: Option<String>,
    pub adaptations_json: Option<String>,
    pub rationale: String,
    /// `pending_review` | `approved` | `superseded`
    pub status: String,
    pub contributor_identity: Identity,
    pub reviewer_identity: Option<Identity>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

/// Versioned artifact component — workflow step, formula, code symbol/range,
/// or document section bound to decisions and claims.
///
/// `component_key` is the stable id; `version` + `content_hash` prevent
/// silent link rewriting on edits. `parent_component_id` preserves fork/edit
/// lineage; `status` marks `active` vs `changed_requires_review` vs `unresolved`.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_artifact_component,
    index(accessor = ai_artifact_component_by_org, btree(columns = [organization_id])),
    index(accessor = ai_artifact_component_by_parent, btree(columns = [parent_component_id])),
    index(accessor = ai_artifact_component_by_decision, btree(columns = [decision_id]))
)]
pub struct AiArtifactComponent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    /// Stable component identity, e.g. `workflow.step:3` or `code:src/foo.rs#handle`.
    pub component_key: String,
    /// `workflow_step` | `formula` | `code_symbol` | `document_section`
    pub component_kind: String,
    pub version: u32,
    pub content_hash: String,
    pub decision_id: Option<u64>,
    pub claim_id: Option<u64>,
    pub parent_component_id: Option<u64>,
    /// `active` | `changed_requires_review` | `unresolved`
    pub status: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Params ─────────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiClaimParams {
    pub company_id: Option<u64>,
    pub source_version_id: Option<u64>,
    pub source_passage_id: Option<u64>,
    pub kind: String,
    pub statement: String,
    pub assumptions_json: Option<String>,
    pub verification_outcome: Option<String>,
    pub status: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiDecisionParams {
    pub company_id: Option<u64>,
    pub claim_id: Option<u64>,
    pub supporting_claims_json: Option<String>,
    pub supporting_sources_json: Option<String>,
    pub applicability: Option<String>,
    pub alternatives_json: Option<String>,
    pub adaptations_json: Option<String>,
    pub rationale: String,
    pub status: String,
    pub reviewer_identity: Option<Identity>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiArtifactComponentParams {
    pub company_id: Option<u64>,
    pub component_key: String,
    pub component_kind: String,
    pub version: u32,
    pub content_hash: String,
    pub decision_id: Option<u64>,
    pub claim_id: Option<u64>,
    pub parent_component_id: Option<u64>,
    pub status: String,
}

// ── Validation ─────────────────────────────────────────────────────────────

fn validate_claim_kind(kind: &str) -> Result<String, String> {
    let k = kind.trim().to_lowercase();
    let allowed = [
        "quotation",
        "paraphrase",
        "sourced_fact",
        "calculation",
        "inference",
        "recommendation",
    ];
    if !allowed.contains(&k.as_str()) {
        return Err(format!("claim kind must be one of {}", allowed.join(", ")));
    }
    Ok(k)
}

fn validate_claim_status(status: &str) -> Result<String, String> {
    let s = status.trim().to_lowercase();
    let allowed = ["pending_review", "verified", "unresolved"];
    if !allowed.contains(&s.as_str()) {
        return Err(format!(
            "claim status must be one of {}",
            allowed.join(", ")
        ));
    }
    Ok(s)
}

fn validate_decision_status(status: &str) -> Result<String, String> {
    let s = status.trim().to_lowercase();
    let allowed = ["pending_review", "approved", "superseded"];
    if !allowed.contains(&s.as_str()) {
        return Err(format!(
            "decision status must be one of {}",
            allowed.join(", ")
        ));
    }
    Ok(s)
}

fn validate_component_status(status: &str) -> Result<String, String> {
    let s = status.trim().to_lowercase();
    let allowed = ["active", "changed_requires_review", "unresolved"];
    if !allowed.contains(&s.as_str()) {
        return Err(format!(
            "component status must be one of {}",
            allowed.join(", ")
        ));
    }
    Ok(s)
}

fn validate_component_kind(kind: &str) -> Result<String, String> {
    let k = kind.trim().to_lowercase();
    let allowed = [
        "workflow_step",
        "formula",
        "code_symbol",
        "document_section",
    ];
    if !allowed.contains(&k.as_str()) {
        return Err(format!(
            "component_kind must be one of {}",
            allowed.join(", ")
        ));
    }
    Ok(k)
}

fn validate_nonempty(field: &str, value: &str, max: usize) -> Result<String, String> {
    let v = value.trim().to_string();
    if v.is_empty() {
        return Err(format!("{field} is required"));
    }
    if v.len() > max {
        return Err(format!("{field} exceeds {max} characters"));
    }
    Ok(v)
}

fn validate_optional(
    field: &str,
    value: &Option<String>,
    max: usize,
) -> Result<Option<String>, String> {
    match value {
        None => Ok(None),
        Some(raw) if raw.trim().is_empty() => Ok(None),
        Some(raw) if raw.trim().len() > max => Err(format!("{field} exceeds {max} characters")),
        Some(raw) => Ok(Some(raw.trim().to_string())),
    }
}

// ── Reducers ───────────────────────────────────────────────────────────────

#[reducer]
pub fn create_ai_claim(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAiClaimParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_source", "write")?;
    if organization_id == 0 {
        return Err("organization_id is required".to_string());
    }

    let kind = validate_claim_kind(&params.kind)?;
    let statement = validate_nonempty("statement", &params.statement, 20_000)?;
    let status = validate_claim_status(&params.status)?;

    if let Some(vid) = params.source_version_id {
        if vid == AUTO_INC_SENTINEL {
            return Err("source_version_id must be nonzero when supplied".to_string());
        }
        let v = ctx
            .db
            .ai_source_version()
            .id()
            .find(&vid)
            .ok_or("source version not found for claim")?;
        if v.organization_id != organization_id {
            return Err("claim source version does not belong to this organization".to_string());
        }
    }
    if let Some(pid) = params.source_passage_id {
        if pid == AUTO_INC_SENTINEL {
            return Err("source_passage_id must be nonzero when supplied".to_string());
        }
        let p = ctx
            .db
            .ai_source_passage()
            .id()
            .find(&pid)
            .ok_or("source passage not found for claim")?;
        if p.organization_id != organization_id {
            return Err("claim source passage does not belong to this organization".to_string());
        }
    }

    if let Some(cid) = params.company_id {
        if cid == AUTO_INC_SENTINEL {
            return Err("company_id must be nonzero when supplied".to_string());
        }
    }

    let row = ctx.db.ai_claim().insert(AiClaim {
        id: AUTO_INC_SENTINEL,
        organization_id,
        company_id: params.company_id,
        source_version_id: params.source_version_id,
        source_passage_id: params.source_passage_id,
        kind,
        statement,
        assumptions_json: validate_optional(
            "assumptions_json",
            &params.assumptions_json,
            MAX_URI_LEN,
        )?,
        verification_outcome: validate_optional(
            "verification_outcome",
            &params.verification_outcome,
            MAX_URI_LEN,
        )?,
        status,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "ai_claim",
            record_id: row.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["kind".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_ai_decision(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAiDecisionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_source", "write")?;
    if organization_id == 0 {
        return Err("organization_id is required".to_string());
    }

    let status = validate_decision_status(&params.status)?;
    let rationale = validate_nonempty("rationale", &params.rationale, 20_000)?;

    if let Some(cid) = params.claim_id {
        if cid == AUTO_INC_SENTINEL {
            return Err("claim_id must be nonzero when supplied".to_string());
        }
        let c = ctx
            .db
            .ai_claim()
            .id()
            .find(&cid)
            .ok_or("claim not found for decision")?;
        if c.organization_id != organization_id {
            return Err("decision claim does not belong to this organization".to_string());
        }
    }

    if let Some(cid) = params.company_id {
        if cid == AUTO_INC_SENTINEL {
            return Err("company_id must be nonzero when supplied".to_string());
        }
    }

    let row = ctx.db.ai_decision().insert(AiDecision {
        id: AUTO_INC_SENTINEL,
        organization_id,
        company_id: params.company_id,
        claim_id: params.claim_id,
        supporting_claims_json: validate_optional(
            "supporting_claims_json",
            &params.supporting_claims_json,
            MAX_URI_LEN,
        )?,
        supporting_sources_json: validate_optional(
            "supporting_sources_json",
            &params.supporting_sources_json,
            MAX_URI_LEN,
        )?,
        applicability: validate_optional("applicability", &params.applicability, MAX_TITLE_LEN)?,
        alternatives_json: validate_optional(
            "alternatives_json",
            &params.alternatives_json,
            MAX_URI_LEN,
        )?,
        adaptations_json: validate_optional(
            "adaptations_json",
            &params.adaptations_json,
            MAX_URI_LEN,
        )?,
        rationale,
        status,
        contributor_identity: ctx.sender(),
        reviewer_identity: params.reviewer_identity,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "ai_decision",
            record_id: row.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["rationale".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_ai_artifact_component(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAiArtifactComponentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_source", "write")?;
    if organization_id == 0 {
        return Err("organization_id is required".to_string());
    }

    let component_key = validate_nonempty("component_key", &params.component_key, MAX_TITLE_LEN)?;
    let component_kind = validate_component_kind(&params.component_kind)?;
    let content_hash = validate_nonempty("content_hash", &params.content_hash, MAX_HASH_LEN)?;
    let status = validate_component_status(&params.status)?;

    if params.version == 0 {
        return Err("version must be nonzero".to_string());
    }
    if let Some(cid) = params.company_id {
        if cid == AUTO_INC_SENTINEL {
            return Err("company_id must be nonzero when supplied".to_string());
        }
    }

    if let Some(did) = params.decision_id {
        if did == AUTO_INC_SENTINEL {
            return Err("decision_id must be nonzero when supplied".to_string());
        }
        let d = ctx
            .db
            .ai_decision()
            .id()
            .find(&did)
            .ok_or("decision not found for component")?;
        if d.organization_id != organization_id {
            return Err("component decision does not belong to this organization".to_string());
        }
    }
    if let Some(cid) = params.claim_id {
        if cid == AUTO_INC_SENTINEL {
            return Err("claim_id must be nonzero when supplied".to_string());
        }
        let c = ctx
            .db
            .ai_claim()
            .id()
            .find(&cid)
            .ok_or("claim not found for component")?;
        if c.organization_id != organization_id {
            return Err("component claim does not belong to this organization".to_string());
        }
    }
    if let Some(pid) = params.parent_component_id {
        if pid == AUTO_INC_SENTINEL {
            return Err("parent_component_id must be nonzero when supplied".to_string());
        }
        let parent = ctx
            .db
            .ai_artifact_component()
            .id()
            .find(&pid)
            .ok_or("parent component not found")?;
        if parent.organization_id != organization_id {
            return Err("parent component does not belong to this organization".to_string());
        }
    }

    // At least one of decision_id / claim_id should anchor the component — a
    // bibliography without component links must not pass the gate.
    if params.decision_id.is_none() && params.claim_id.is_none() {
        return Err("component must reference a decision or claim".to_string());
    }

    let row = ctx.db.ai_artifact_component().insert(AiArtifactComponent {
        id: AUTO_INC_SENTINEL,
        organization_id,
        company_id: params.company_id,
        component_key,
        component_kind,
        version: params.version,
        content_hash,
        decision_id: params.decision_id,
        claim_id: params.claim_id,
        parent_component_id: params.parent_component_id,
        status,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "ai_artifact_component",
            record_id: row.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["component_key".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
