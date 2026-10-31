//! Runtime lifecycle regression for company-scoped assistant guide revisions.
use crate::ai::evidence_lineage::{
    ai_evidence_claim, ai_evidence_decision, record_ai_evidence_claim, record_ai_evidence_decision,
    AiEvidenceDecision, RecordAiEvidenceClaimParams, RecordAiEvidenceDecisionParams,
};
use crate::ai::evidence_source::{
    ai_evidence_passage, record_ai_evidence_passage, RecordAiEvidencePassageParams,
};
use crate::ai::knowledge_entry::{
    ai_knowledge_entry, ai_knowledge_entry_version, review_ai_knowledge_entry_version,
    ReviewAiKnowledgeEntryVersionParams,
};
use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::core::permissions::{role, user_role_assignment, Role, UserRoleAssignment};
use crate::core::users::{
    find_user_profile_for_organization, user_organization, user_profile, UserOrganization,
    UserProfile,
};
use crate::documents::knowledge::{
    knowledge_article, update_knowledge_article, UpdateKnowledgeArticleParams,
};
use crate::documents::knowledge_guides::{
    guide_knowledge_key, knowledge_guide, knowledge_guide_revision, nominate_knowledge_guide,
    save_knowledge_guide_inner, SaveKnowledgeGuideParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use spacetimedb::{ReducerContext, Table};

pub fn lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company = fixture.company_id;
    let original = SaveKnowledgeGuideParams {
        guide_id: None,
        expected_revision: None,
        request_key: "guide-create".into(),
        draft_key: "draft-1".into(),
        title: "Sensitive bill explanation".into(),
        module: "accounting".into(),
        workflow: Some("vendor-bills".into()),
        markdown: "Original private text".into(),
        html: None,
        language: "en".into(),
        workflow_version: None,
        sources_json: "[]".into(),
        origin_message_id: None,
        origin_run_id: None,
    };
    save_knowledge_guide_inner(ctx, org, company, original.clone())?;
    let head = ctx
        .db
        .knowledge_guide()
        .knowledge_guide_by_org()
        .filter(&org)
        .next()
        .ok_or("guide head missing")?;
    let article = ctx
        .db
        .knowledge_article()
        .id()
        .find(&head.id)
        .ok_or("library shell missing")?;
    if article.body.is_some() || article.name.contains("Sensitive") || article.is_published {
        return Err("private guide leaked through public article shell".into());
    }
    save_knowledge_guide_inner(ctx, org, company, original.clone())?;
    if ctx
        .db
        .knowledge_guide_revision()
        .knowledge_guide_revision_by_guide()
        .filter(&head.id)
        .count()
        != 1
    {
        return Err("save retry duplicated guide revision".into());
    }
    let mut changed_key = original.clone();
    changed_key.markdown = "Different request".into();
    if save_knowledge_guide_inner(ctx, org, company, changed_key).is_ok() {
        return Err("reused request key accepted changed content".into());
    }
    let (passage, claim, decision) = verification_evidence(ctx, org, company)?;
    nominate_knowledge_guide(
        ctx,
        org,
        company,
        head.id,
        1,
        vec![passage],
        vec![claim],
        vec![decision],
    )?;
    nominate_knowledge_guide(
        ctx,
        org,
        company,
        head.id,
        1,
        vec![passage],
        vec![claim],
        vec![decision],
    )?;
    let key = guide_knowledge_key(head.id, 1);
    let entry = ctx
        .db
        .ai_knowledge_entry()
        .ai_knowledge_entry_by_key()
        .filter((&org, &company, &key))
        .next()
        .ok_or("guide review candidate missing")?;
    let versions: Vec<_> = ctx
        .db
        .ai_knowledge_entry_version()
        .ai_knowledge_entry_version_by_entry()
        .filter(&entry.id)
        .collect();
    if versions.len() != 1
        || versions[0].body != original.markdown
        || versions[0].review_state != "candidate"
        || entry.share_scope != "personal"
    {
        return Err("guide nomination duplicated, changed or published private content".into());
    }
    let candidate = versions[0].clone();
    if review_ai_knowledge_entry_version(
        ctx,
        org,
        company,
        candidate.id,
        ReviewAiKnowledgeEntryVersionParams {
            review_kind: "source_fidelity".into(),
            outcome: "accepted".into(),
            note: None,
        },
    )
    .is_ok()
    {
        return Err("guide author approved their own candidate".into());
    }
    let mut update = original.clone();
    update.guide_id = Some(head.id);
    update.expected_revision = Some(1);
    update.request_key = "guide-update".into();
    update.markdown = "Second revision".into();
    save_knowledge_guide_inner(ctx, org, company, update.clone())?;
    let invalidated = ctx
        .db
        .ai_knowledge_entry_version()
        .id()
        .find(&candidate.id)
        .ok_or("guide review candidate disappeared")?;
    if invalidated.review_state != "needs_review"
        || invalidated.review_epoch != candidate.review_epoch + 1
    {
        return Err("saving a new guide revision retained its prior review epoch".into());
    }
    if nominate_knowledge_guide(
        ctx,
        org,
        company,
        head.id,
        1,
        vec![passage],
        vec![claim],
        vec![decision],
    )
    .is_ok()
    {
        return Err("a historical guide revision was nominated as current".into());
    }
    save_knowledge_guide_inner(ctx, org, company, update.clone())?;
    update.request_key = "stale-update".into();
    if save_knowledge_guide_inner(ctx, org, company, update).is_ok() {
        return Err("stale revision overwrote guide".into());
    }
    let revisions: Vec<_> = ctx
        .db
        .knowledge_guide_revision()
        .knowledge_guide_revision_by_guide()
        .filter(&head.id)
        .collect();
    if revisions.len() != 2
        || !revisions
            .iter()
            .any(|r| r.revision == 1 && r.markdown == "Original private text")
    {
        return Err("old guide revision was modified".into());
    }
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let mut foreign_update = original.clone();
    foreign_update.guide_id = Some(head.id);
    foreign_update.expected_revision = Some(2);
    foreign_update.request_key = "foreign-update".into();
    if save_knowledge_guide_inner(
        ctx,
        foreign.organization_id,
        foreign.company_id,
        foreign_update,
    )
    .is_ok()
    {
        return Err("foreign scope accepted guide update".into());
    }
    let bypass = UpdateKnowledgeArticleParams {
        company_id: Some(company),
        name: Some("Bypass".into()),
        description: None,
        body: Some("Unversioned edit".into()),
        icon: None,
        color: None,
        category_id: None,
        internal_permission: None,
        article_url: None,
        is_published: None,
        website_url: None,
        metadata: None,
    };
    if update_knowledge_article(ctx, org, head.id, bypass).is_ok() {
        return Err("generic article operation bypassed guide revision owner".into());
    }
    company_access(ctx, original)
}

fn verification_evidence(
    ctx: &ReducerContext,
    org: u64,
    company: u64,
) -> Result<(u64, u64, u64), String> {
    record_ai_evidence_passage(
        ctx,
        org,
        company,
        RecordAiEvidencePassageParams {
            source_kind: "policy".into(),
            source_key: format!("guide-runtime-{org}"),
            source_version: "1".into(),
            passage_key: "checks".into(),
            passage_text: "Review the current bill before posting.".into(),
            effective_from_micros: None,
            effective_to_micros: None,
            applicability: vec![],
            source_version_id: None,
            coordinates: vec!["section:checks".into()],
            text_origin: "original".into(),
            processor_ref: None,
        },
    )?;
    let passage = ctx
        .db
        .ai_evidence_passage()
        .iter()
        .find(|row| row.organization_id == org && row.source_key == format!("guide-runtime-{org}"))
        .ok_or("guide passage missing")?
        .id;
    record_ai_evidence_claim(
        ctx,
        org,
        company,
        RecordAiEvidenceClaimParams {
            kind: "sourced_fact".into(),
            statement: "Review the current bill before posting.".into(),
            supporting_passage_ids: vec![passage],
            contradicting_passage_ids: vec![],
            calculation_ref: None,
            assumptions: vec![],
            contribution_id: None,
            verification_method: "none".into(),
            verification_outcome: "unverified".into(),
            verification_note: None,
            supersedes_claim_id: None,
        },
    )?;
    let claim = ctx
        .db
        .ai_evidence_claim()
        .iter()
        .find(|row| row.organization_id == org && row.supporting_passage_ids == vec![passage])
        .ok_or("guide claim missing")?
        .id;
    record_ai_evidence_decision(
        ctx,
        org,
        company,
        RecordAiEvidenceDecisionParams {
            title: "Use the current bill checks".into(),
            adopted_claim_ids: vec![claim],
            supporting_claim_ids: vec![],
            applicability: vec![],
            alternatives: vec![],
            adaptations: vec![],
            assumptions: vec![],
            rationale: "The guide explains these review checks.".into(),
            contribution_id: None,
            supersedes_decision_id: None,
        },
    )?;
    let decision = ctx
        .db
        .ai_evidence_decision()
        .iter()
        .find(|row| row.organization_id == org && row.adopted_claim_ids == vec![claim])
        .ok_or("guide decision missing")?;
    // This fixture focuses on the guide adapter. The real-service two-identity
    // lifecycle exercises actual independent claim/decision and guide reviews.
    let id = decision.id;
    ctx.db
        .ai_evidence_decision()
        .id()
        .update(AiEvidenceDecision {
            status: "accepted".into(),
            ..decision
        });
    Ok((passage, claim, id))
}

fn company_access(ctx: &ReducerContext, params: SaveKnowledgeGuideParams) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company = fixture.company_id;
    create_company(
        ctx,
        org,
        CreateCompanyParams {
            name: "Guide branch".into(),
            code: "GUIDE-BRANCH".into(),
            currency_id: fixture.currency_id,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: None,
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: None,
        },
    )?;
    let branch = ctx
        .db
        .company()
        .company_by_org()
        .filter(&org)
        .find(|row| row.id != company)
        .ok_or("guide branch fixture missing")?
        .id;
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == org && row.is_active)
        .ok_or("guide membership fixture missing")?;
    let original_role = ctx
        .db
        .role()
        .id()
        .find(&membership.role_id)
        .ok_or("guide role fixture missing")?;
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), org)
        .ok_or("guide profile fixture missing")?;
    let was_superuser = profile.is_superuser;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..profile
    });
    ctx.db.user_organization().id().update(UserOrganization {
        company_id: Some(company),
        ..membership.clone()
    });
    let save = |company_id, key: &str| {
        let mut draft = params.clone();
        draft.request_key = key.into();
        save_knowledge_guide_inner(ctx, org, company_id, draft)
    };
    // A company-bound organization administrator must follow the same company
    // switch that the authenticated API accepts, without superuser bypass.
    save(branch, "company-admin-switch")?;
    ctx.db.role().id().update(Role {
        permissions: vec!["knowledge_article:*".into()],
        ..original_role.clone()
    });
    save(company, "company-bound-save")?;
    if save(branch, "company-bound-denied").is_ok() {
        return Err("resource wildcard expanded a guide's company scope".into());
    }
    ctx.db.user_organization().id().update(UserOrganization {
        company_id: None,
        ..membership.clone()
    });
    save(company, "company-default-save")?;
    if save(branch, "company-default-denied").is_ok() {
        return Err("unbound ordinary member bypassed the default guide company".into());
    }
    let global_role = ctx.db.role().insert(Role {
        id: 0,
        name: "Guide organization administrator".into(),
        permissions: vec!["*:*".into()],
        is_system: false,
        ..original_role.clone()
    });
    let assignment = ctx.db.user_role_assignment().insert(UserRoleAssignment {
        id: 0,
        user_identity: ctx.sender(),
        organization_id: org,
        role_id: global_role.id,
        assigned_by: ctx.sender(),
        assigned_at: ctx.timestamp,
        expires_at: Some(ctx.timestamp),
        is_active: true,
        metadata: None,
    });
    if save(branch, "company-expired-denied").is_ok() {
        return Err("expired role expanded a guide's company scope".into());
    }
    ctx.db
        .user_role_assignment()
        .id()
        .update(UserRoleAssignment {
            expires_at: None,
            ..assignment.clone()
        });
    save(branch, "company-additive-switch")?;
    ctx.db.role().id().update(Role {
        is_active: false,
        ..global_role.clone()
    });
    if save(branch, "company-inactive-role-denied").is_ok() {
        return Err("inactive role expanded a guide's company scope".into());
    }
    let duplicate = ctx.db.user_organization().insert(UserOrganization {
        id: 0,
        ..membership.clone()
    });
    if save(company, "company-ambiguous-denied").is_ok() {
        return Err("ambiguous membership authorized a guide save".into());
    }
    ctx.db.user_organization().id().delete(&duplicate.id);
    ctx.db.user_organization().id().update(membership);
    ctx.db.role().id().update(original_role);
    ctx.db.user_role_assignment().id().delete(&assignment.id);
    ctx.db.role().id().delete(&global_role.id);
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), org)
        .ok_or("guide profile fixture disappeared")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: was_superuser,
        ..profile
    });
    Ok(())
}
