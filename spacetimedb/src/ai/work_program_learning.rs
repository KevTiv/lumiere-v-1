//! Immutable procedural-memory bindings to the canonical reviewed knowledge owner.
//!
//! This is not another approval, evidence or execution engine. A recipe only
//! names an already approved procedure and multiple verified decision cases.
//! Retrieval rechecks the original reviews, dependencies and case/run state.
//! No caller supplies a review status, reviewer identity or executable content.

use std::collections::BTreeMap;

use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::decision_precedent::ai_decision_case;
use crate::ai::evidence_dependency::{require_dependencies_usable, DependentKind};
use crate::ai::knowledge_entry::{
    ai_knowledge_entry_version, ai_knowledge_review, load_entry, load_version,
    require_entry_scope_access, required_review_kinds, AiKnowledgeEntryVersion, STATE_APPROVED,
};
use crate::ai::skills::ai_agent_run;
use crate::core::audit::{audit_log, AuditLog};
use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::helpers::check_permission;
use crate::workflow::authorization::require_workflow_company_access;

/// A version is immutable; author a new binding when procedure or pins change.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_work_program_recipe,
    index(accessor = ai_work_program_recipe_by_org, btree(columns = [organization_id])),
    index(accessor = ai_work_program_recipe_by_knowledge, btree(columns = [knowledge_version_id]))
)]
pub struct AiWorkProgramRecipe {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub request_key: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub program_ref: String,
    pub graph_hash: String,
    pub application_contract: String,
    pub knowledge_version_id: u64,
    pub knowledge_review_epoch: u32,
    pub source_case_ids: Vec<u64>,
    pub payload_hash: String,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

/// Revocation is append-only, and cannot be undone by replaying registration.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_work_program_recipe_revocation,
    index(accessor = ai_work_program_recipe_revocation_by_org, btree(columns = [organization_id]))
)]
pub struct AiWorkProgramRecipeRevocation {
    #[primary_key]
    pub recipe_id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub reason: String,
    pub revoked_by: Identity,
    pub revoked_at: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RegisterAiWorkProgramRecipeParams {
    pub idempotency_key: String,
    pub program_ref: String,
    pub graph_hash: String,
    pub application_contract: String,
    pub knowledge_version_id: u64,
    /// Canonical ascending IDs; at least two independently observed cases.
    pub source_case_ids: Vec<u64>,
}

#[reducer]
pub fn register_ai_work_program_recipe(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RegisterAiWorkProgramRecipeParams,
) -> Result<(), String> {
    require_scope(ctx, organization_id, company_id, "write")?;
    validate_registration(&params)?;
    let version = require_current_procedure(
        ctx,
        organization_id,
        company_id,
        params.knowledge_version_id,
        None,
    )?;
    require_cases(
        ctx,
        organization_id,
        company_id,
        &params.program_ref,
        &params.source_case_ids,
    )?;
    let request_key = format!(
        "{organization_id}:{company_id}:{}:{}",
        ctx.sender().to_hex(),
        params.idempotency_key
    );
    let payload_hash = format!("{:x}", Sha256::digest(serde_json::to_vec(&serde_json::json!({
        "programRef": params.program_ref, "graphHash": params.graph_hash, "applicationContract": params.application_contract,
        "knowledgeVersionId": params.knowledge_version_id,
        "knowledgeReviewEpoch": version.review_epoch, "sourceCaseIds": params.source_case_ids,
    })).map_err(|e| e.to_string())?));
    if let Some(existing) = ctx
        .db
        .ai_work_program_recipe()
        .request_key()
        .find(&request_key)
    {
        return if existing.payload_hash == payload_hash {
            Ok(())
        } else {
            Err("recipe request key conflicts with the existing payload".into())
        };
    }
    let row = ctx.db.ai_work_program_recipe().insert(AiWorkProgramRecipe {
        id: 0,
        request_key: request_key.clone(),
        organization_id,
        company_id,
        program_ref: params.program_ref,
        graph_hash: params.graph_hash,
        application_contract: params.application_contract,
        knowledge_version_id: params.knowledge_version_id,
        knowledge_review_epoch: version.review_epoch,
        source_case_ids: params.source_case_ids,
        payload_hash,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });
    let changes = audited_changes(
        ctx,
        organization_id,
        company_id,
        "ai_work_program_recipe",
        row.id,
        RowChange::upsert_stdb_row(
            "ai_work_program_recipe",
            serde_json::json!({"id": row.id}),
            &row,
        )?,
    )?;
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.register_ai_work_program_recipe".to_string(),
            correlation_id: request_key,
            changes,
        },
    )?;
    Ok(())
}

#[reducer]
pub fn revoke_ai_work_program_recipe(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    recipe_id: u64,
    reason: String,
) -> Result<(), String> {
    require_scope(ctx, organization_id, company_id, "write")?;
    bounded("reason", &reason, 2_000)?;
    let recipe = ctx
        .db
        .ai_work_program_recipe()
        .id()
        .find(&recipe_id)
        .ok_or("recipe not found")?;
    if recipe.organization_id != organization_id || recipe.company_id != company_id {
        return Err("recipe is outside requested scope".into());
    }
    let version = load_version(
        ctx,
        organization_id,
        company_id,
        recipe.knowledge_version_id,
    )?;
    let entry = load_entry(ctx, organization_id, company_id, version.entry_id)?;
    require_entry_scope_access(ctx, &entry, ctx.sender())?;
    if let Some(existing) = ctx
        .db
        .ai_work_program_recipe_revocation()
        .recipe_id()
        .find(&recipe_id)
    {
        return if existing.revoked_by == ctx.sender() && existing.reason == reason {
            Ok(())
        } else {
            Err("recipe is already revoked by another request".into())
        };
    }
    let row = ctx
        .db
        .ai_work_program_recipe_revocation()
        .insert(AiWorkProgramRecipeRevocation {
            recipe_id,
            organization_id,
            company_id,
            reason,
            revoked_by: ctx.sender(),
            revoked_at: ctx.timestamp,
        });
    let changes = audited_changes(
        ctx,
        organization_id,
        company_id,
        "ai_work_program_recipe_revocation",
        recipe_id,
        RowChange::upsert_stdb_row(
            "ai_work_program_recipe_revocation",
            serde_json::json!({"recipe_id": recipe_id}),
            &row,
        )?,
    )?;
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.revoke_ai_work_program_recipe".to_string(),
            correlation_id: format!("recipe:{recipe_id}"),
            changes,
        },
    )?;
    Ok(())
}

/// Scoped current read for a future admitted adapter. A binding never carries
/// historical knowledge access forward and grants no execution authority.
#[allow(dead_code)]
pub(crate) fn retrieve_work_program_recipe(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    recipe_id: u64,
    graph_hash: &str,
    application_contract: &str,
) -> Result<AiKnowledgeEntryVersion, String> {
    require_scope(ctx, organization_id, company_id, "retrieve")?;
    let recipe = ctx
        .db
        .ai_work_program_recipe()
        .id()
        .find(&recipe_id)
        .ok_or("recipe not found")?;
    if recipe.organization_id != organization_id
        || recipe.company_id != company_id
        || recipe.graph_hash != graph_hash
        || recipe.application_contract != application_contract
    {
        return Err("recipe scope or program applicability differs".into());
    }
    if ctx
        .db
        .ai_work_program_recipe_revocation()
        .recipe_id()
        .find(&recipe_id)
        .is_some()
    {
        return Err("recipe is revoked".into());
    }
    require_cases(
        ctx,
        organization_id,
        company_id,
        &recipe.program_ref,
        &recipe.source_case_ids,
    )?;
    require_current_procedure(
        ctx,
        organization_id,
        company_id,
        recipe.knowledge_version_id,
        Some(recipe.knowledge_review_epoch),
    )
}

fn require_scope(ctx: &ReducerContext, org: u64, company: u64, action: &str) -> Result<(), String> {
    check_permission(ctx, org, "ai_knowledge_entry", action)?;
    check_permission(ctx, org, "ai_agent_run", "read")?;
    if require_workflow_company_access(ctx, org, company, ctx.sender())? {
        return Err("recipe access requires current company membership".into());
    }
    Ok(())
}

fn require_current_procedure(
    ctx: &ReducerContext,
    org: u64,
    company: u64,
    version_id: u64,
    epoch: Option<u32>,
) -> Result<AiKnowledgeEntryVersion, String> {
    let version = load_version(ctx, org, company, version_id)?;
    let entry = load_entry(ctx, org, company, version.entry_id)?;
    require_entry_scope_access(ctx, &entry, ctx.sender())?;
    if entry.kind != "procedure"
        || version.review_state != STATE_APPROVED
        || epoch.is_some_and(|e| e != version.review_epoch)
    {
        return Err("recipe requires the current approved procedure review epoch".into());
    }
    let latest = ctx
        .db
        .ai_knowledge_entry_version()
        .ai_knowledge_entry_version_by_entry()
        .filter(&entry.id)
        .max_by_key(|v| v.version)
        .ok_or("knowledge entry has no version")?;
    if latest.id != version.id {
        return Err("recipe procedure has a newer version".into());
    }
    require_dependencies_usable(ctx, org, DependentKind::KnowledgeVersion, version.id)?;
    let reviews: Vec<_> = ctx
        .db
        .ai_knowledge_review()
        .ai_knowledge_review_by_version()
        .filter(&version.id)
        .take(257)
        .collect();
    if reviews.len() > 256 {
        return Err("recipe review history exceeds bounded reader".into());
    }
    let mut current = BTreeMap::new();
    for review in reviews
        .into_iter()
        .filter(|r| r.review_epoch == version.review_epoch)
    {
        if current
            .get(&review.review_kind)
            .is_none_or(|r: &crate::ai::knowledge_entry::AiKnowledgeReview| r.id < review.id)
        {
            current.insert(review.review_kind.clone(), review);
        }
    }
    for kind in required_review_kinds("procedure") {
        let review = current
            .get(*kind)
            .ok_or("recipe procedure has missing current review")?;
        if review.organization_id != org
            || review.company_id != company
            || review.outcome != "accepted"
            || review.reviewer_uid == entry.owner_uid
            || review.reviewer_uid == version.create_uid
        {
            return Err("recipe procedure lacks independent accepted reviews".into());
        }
    }
    Ok(version)
}

fn require_cases(
    ctx: &ReducerContext,
    org: u64,
    company: u64,
    program_ref: &str,
    ids: &[u64],
) -> Result<(), String> {
    let mut runs = std::collections::BTreeSet::new();
    for id in ids {
        let case = ctx
            .db
            .ai_decision_case()
            .id()
            .find(id)
            .ok_or("recipe source case not found")?;
        if case.organization_id != org
            || case.company_id != company
            || case.program_ref != program_ref
            || case.status != "approved"
            || case.verification_status.as_deref() != Some("verified")
            || case.outcome_status != "success"
        {
            return Err(
                "recipe requires currently approved verified successful same-scope cases".into(),
            );
        }
        let run = ctx
            .db
            .ai_agent_run()
            .id()
            .find(&case.run_id)
            .ok_or("recipe source run not found")?;
        if run.organization_id != org || run.company_id != company || run.status != "completed" {
            return Err("recipe source run is not completed in scope".into());
        }
        runs.insert(run.id);
    }
    if runs.len() < 2 {
        return Err(
            "recipe requires observations from at least two distinct completed runs".into(),
        );
    }
    Ok(())
}

fn validate_registration(params: &RegisterAiWorkProgramRecipeParams) -> Result<(), String> {
    bounded("idempotency_key", &params.idempotency_key, 160)?;
    bounded("program_ref", &params.program_ref, 160)?;
    bounded("application_contract", &params.application_contract, 160)?;
    if params.graph_hash.len() != 64
        || !params
            .graph_hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("graph_hash must be lowercase SHA-256".into());
    }
    if params.knowledge_version_id == 0
        || !(2..=16).contains(&params.source_case_ids.len())
        || params.source_case_ids[0] == 0
        || params.source_case_ids.windows(2).any(|p| p[0] >= p[1])
    {
        return Err("recipe requires two to sixteen unique ascending positive source cases".into());
    }
    Ok(())
}

fn bounded(name: &str, value: &str, max: usize) -> Result<(), String> {
    if value.is_empty()
        || value.len() > max
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(format!("{name} is empty, oversized or noncanonical"));
    }
    Ok(())
}

fn audited_changes(
    ctx: &ReducerContext,
    org: u64,
    company: u64,
    table: &str,
    id: u64,
    change: RowChange,
) -> Result<Vec<RowChange>, String> {
    let audit = ctx.db.audit_log().insert(AuditLog {
        id: 0,
        organization_id: org,
        company_id: Some(company),
        table_name: table.into(),
        record_id: id,
        action: "CREATE".into(),
        old_values: None,
        new_values: None,
        changed_fields: vec![],
        user_identity: ctx.sender(),
        session_id: ctx.connection_id().map(|c| c.to_u128() as u64),
        ip_address: None,
        user_agent: None,
        timestamp: ctx.timestamp,
        metadata: Some("non-executable procedural memory binding".into()),
    });
    Ok(vec![
        change,
        RowChange::upsert_stdb_row("audit_log", serde_json::json!({"id": audit.id}), &audit)?,
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    fn params() -> RegisterAiWorkProgramRecipeParams {
        RegisterAiWorkProgramRecipeParams {
            idempotency_key: "recipe-1".into(),
            program_ref: "skill:report_analysis@1".into(),
            graph_hash: "a".repeat(64),
            application_contract: "v0.3.163".into(),
            knowledge_version_id: 1,
            source_case_ids: vec![1, 2],
        }
    }
    #[test]
    fn recipe_cannot_graduate_from_a_single_case_or_duplicate_lineage() {
        let mut p = params();
        assert!(validate_registration(&p).is_ok());
        p.source_case_ids = vec![1];
        assert!(validate_registration(&p).is_err());
        p.source_case_ids = vec![1, 1];
        assert!(validate_registration(&p).is_err());
        p.source_case_ids = vec![0, 1];
        assert!(validate_registration(&p).is_err());
    }
    #[test]
    fn recipe_requires_exact_bounded_program_pins() {
        let mut p = params();
        p.graph_hash = "A".repeat(64);
        assert!(validate_registration(&p).is_err());
        p.graph_hash = "a".repeat(64);
        p.application_contract = "  v0.3.163".into();
        assert!(validate_registration(&p).is_err());
        p.application_contract = "x".repeat(161);
        assert!(validate_registration(&p).is_err());
    }
}
