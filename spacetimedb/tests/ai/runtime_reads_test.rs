//! Exercise sender scope with real database rows and service retirement.
use super::evidence_provenance_test::seed_evidence;
use crate::ai::capability_execution::{ai_capability_execution, AiCapabilityExecution};
use crate::ai::runtime_reads::*;
use crate::core::cold_tier_identity::{
    cold_tier_service_identity, ColdTierServiceIdentity, AI_SPEND_READER_SERVICE,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use spacetimedb::{Identity, ReducerContext, Table, ViewContext};

pub fn test_runtime_reads_scope_and_retirement(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let reader = Identity::from_byte_array([0xb1; 32]);
    let stranger = Identity::from_byte_array([0xb2; 32]);
    let binding = ColdTierServiceIdentity {
        platform_id: format!("runtime-read-test-{}", local.organization_id),
        organization_id: local.organization_id,
        service_name: AI_SPEND_READER_SERVICE.into(),
        identity: reader,
        is_active: true,
        registered_by: ctx.sender(),
        registered_at: ctx.timestamp,
        retired_at: None,
    };
    ctx.db.cold_tier_service_identity().insert(binding.clone());
    for fixture in [&local, &foreign] {
        ctx.db
            .ai_capability_execution()
            .insert(AiCapabilityExecution {
                id: 0,
                organization_id: fixture.organization_id,
                company_id: fixture.company_id,
                run_id: fixture.company_id,
                recovery_key: format!("gp03:test:{}", fixture.organization_id),
                capability: "analytics_summary".into(),
                status: "claimed".into(),
                output_json: None,
                output_hash: None,
                failure_reason: None,
                claimed_by: ctx.sender(),
                write_uid: ctx.sender(),
                created_at: ctx.timestamp,
                finished_at: None,
                write_date: ctx.timestamp,
            });
        seed_evidence(
            ctx,
            fixture.organization_id,
            fixture.company_id,
            "runtime-read-source",
            "company",
        )?;
    }
    let view = ViewContext::new(reader);
    let recovery = ai_capability_execution_read(&view);
    if recovery.len() != 1 || recovery[0].organization_id != local.organization_id {
        return Err("recovery view must return only the registered organization".into());
    }
    let passages = ai_evidence_passage_read(&view);
    if passages.len() != 1 || passages[0].organization_id != local.organization_id {
        return Err("passage view must return only the registered organization".into());
    }
    for orgs in [
        ai_evidence_source_read(&view)
            .iter()
            .map(|r| r.organization_id)
            .collect::<Vec<_>>(),
        ai_evidence_source_version_read(&view)
            .iter()
            .map(|r| r.organization_id)
            .collect::<Vec<_>>(),
    ] {
        if orgs != vec![local.organization_id] {
            return Err("source view leaked a foreign organization".into());
        }
    }
    fn require_empty(view: &ViewContext) -> Result<(), String> {
        if !ai_capability_execution_read(view).is_empty() {
            return Err("ai_capability_execution disclosed rows without an active binding".into());
        }
        if !ai_evidence_passage_read(view).is_empty() {
            return Err("ai_evidence_passage disclosed rows without an active binding".into());
        }
        if !ai_evidence_source_read(view).is_empty() {
            return Err("ai_evidence_source disclosed rows without an active binding".into());
        }
        if !ai_evidence_source_version_read(view).is_empty() {
            return Err(
                "ai_evidence_source_version disclosed rows without an active binding".into(),
            );
        }
        if !ai_evidence_contribution_read(view).is_empty() {
            return Err("ai_evidence_contribution disclosed rows without an active binding".into());
        }
        if !ai_evidence_claim_read(view).is_empty() {
            return Err("ai_evidence_claim disclosed rows without an active binding".into());
        }
        if !ai_evidence_decision_read(view).is_empty() {
            return Err("ai_evidence_decision disclosed rows without an active binding".into());
        }
        if !ai_artifact_component_read(view).is_empty() {
            return Err("ai_artifact_component disclosed rows without an active binding".into());
        }
        if !ai_evidence_dependency_read(view).is_empty() {
            return Err("ai_evidence_dependency disclosed rows without an active binding".into());
        }
        if !ai_evidence_source_change_read(view).is_empty() {
            return Err(
                "ai_evidence_source_change disclosed rows without an active binding".into(),
            );
        }
        if !ai_knowledge_entry_read(view).is_empty() {
            return Err("ai_knowledge_entry disclosed rows without an active binding".into());
        }
        if !ai_knowledge_entry_version_read(view).is_empty() {
            return Err(
                "ai_knowledge_entry_version disclosed rows without an active binding".into(),
            );
        }
        if !ai_knowledge_review_read(view).is_empty() {
            return Err("ai_knowledge_review disclosed rows without an active binding".into());
        }
        Ok(())
    }
    require_empty(&ViewContext::new(stranger))?;
    ctx.db
        .cold_tier_service_identity()
        .platform_id()
        .update(ColdTierServiceIdentity {
            is_active: false,
            retired_at: Some(ctx.timestamp),
            ..binding
        });
    require_empty(&view)?;
    Ok(())
}
