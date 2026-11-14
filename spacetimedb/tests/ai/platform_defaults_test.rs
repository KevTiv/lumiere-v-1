use crate::ai::agents::{ai_agent, set_ai_agent_active};
use crate::ai::model_configuration::RegisterAiModelProfileParams;
use crate::ai::platform_defaults::*;
use crate::ai::skills::{ai_skill, ai_skill_config, AiSkill};
use crate::ai::spend::ai_spend_budget;
use crate::core::organization::{company, Company};
use crate::core::permissions::{
    org_permission, role, OrgPermission, PermissionAction, PermissionEffect, PermissionSubject,
    Role,
};
use crate::core::users::{find_user_profile_for_organization, user_organization};
use crate::helpers::{resolve_permission, PermissionResolution};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use lumiere_policy_core::ai_skills::BUILTIN_SKILL_KEYS;
use spacetimedb::{ReducerContext, Table};

pub fn test_platform_defaults(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let original_default = ctx
        .db
        .ai_platform_default()
        .id()
        .find(1)
        .and_then(|row| row.template_id);
    set_ai_platform_default(ctx, None)?;
    let first = OrgFixture::seed_minimal(ctx)?;
    let second = OrgFixture::seed_minimal(ctx)?;
    let mut ids = Vec::new();
    for key in [
        "rag_generation",
        "form_suggestion",
        "action_draft_generation",
    ] {
        let existing = ctx
            .db
            .ai_skill()
            .ai_skill_by_org()
            .filter(&0u64)
            .find(|row| row.skill_key == key);
        let row = if let Some(row) = existing {
            row
        } else {
            ctx.db.ai_skill().insert(AiSkill {
                id: 0,
                organization_id: 0,
                skill_key: key.into(),
                name: key.into(),
                description: None,
                category: "generation".into(),
                prompt_template: "Use authorized ERP evidence".into(),
                required_tools: vec![],
                optional_tools: vec![],
                default_max_steps: 5,
                default_max_tool_calls: 5,
                output_schema: None,
                config_schema: None,
                dataset_specs: None,
                allowed_action_drafts: vec![],
                is_active: true,
                is_system: true,
                create_date: ctx.timestamp,
                write_date: ctx.timestamp,
                metadata: None,
            })
        };
        ids.push(row.id);
    }
    let profile = |model: &str, roles: Vec<String>| RegisterAiModelProfileParams {
        profile_key: "test".into(),
        profile_version: 1,
        provider: "mistral".into(),
        model: model.into(),
        allowed_roles: roles,
        temperature: Some(0.0),
        top_p: Some(1.0),
        max_tokens: 1024,
        context_window: 32000,
        timeout_ms: 30000,
        max_retries: 0,
        max_concurrency: 1,
        supports_tool_calling: true,
        supports_structured_output: true,
        supports_parallel_requests: false,
        input_cost_per_1k_microunits: Some(100),
        output_cost_per_1k_microunits: Some(200),
        per_request_cost_ceiling_microunits: None,
    };
    // Isolated fixture: the template is platform-owned; do not replace any
    // existing deployment reader bindings merely to run the native suite.
    let template = ctx.db.ai_platform_template().insert(AiPlatformTemplate {
        id: 0,
        template_key: format!("native-{}", first.organization_id),
        template_version: 1,
        generation_profile: profile(
            "mistral-small-2603",
            vec!["generation".into(), "decision".into(), "reasoning".into()],
        ),
        review_profile: profile("mistral-medium-3-5", vec!["review".into()]),
        skill_fingerprints: ids
            .iter()
            .map(|id| skill_fingerprint(&ctx.db.ai_skill().id().find(*id).expect("fixture skill")))
            .collect(),
        skill_ids: ids,
        currency: "USD".into(),
        monthly_limit_units: 5000000,
        rate_limit_per_minute: 10,
        max_enrolled_organizations: 1,
        spend_reader_identity: ctx.sender(),
        runtime_writer_identity: spacetimedb::Identity::from_byte_array([0xd7; 32]),
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });
    set_ai_platform_default(ctx, Some(template.id))?;
    let catalog_snapshot = || {
        let mut rows: Vec<_> = ctx
            .db
            .ai_skill()
            .ai_skill_by_org()
            .filter(&0u64)
            .filter(|row| BUILTIN_SKILL_KEYS.contains(&row.skill_key.as_str()))
            .map(|row| (row.skill_key, row.id, row.is_active, row.is_system))
            .collect();
        rows.sort();
        rows
    };
    let catalog = catalog_snapshot();
    if !catalog
        .iter()
        .map(|(key, ..)| key.as_str())
        .eq(BUILTIN_SKILL_KEYS.iter().copied())
    {
        return Err("platform default did not provision every built-in skill exactly once".into());
    }
    set_ai_platform_default(ctx, Some(template.id))?;
    if catalog != catalog_snapshot() {
        return Err("platform default reconciliation changed existing built-in rows".into());
    }
    enroll_ai_company_defaults(ctx, first.organization_id, first.company_id)?;
    let enrollment = ctx
        .db
        .ai_managed_enrollment()
        .organization_id()
        .find(first.organization_id)
        .ok_or("enrollment missing")?;
    let writer = template.runtime_writer_identity;
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&writer)
        .find(|row| row.organization_id == first.organization_id)
        .ok_or("writer membership missing")?;
    let writer_role = ctx
        .db
        .role()
        .id()
        .find(membership.role_id)
        .ok_or("writer role missing")?;
    let writer_profile = find_user_profile_for_organization(ctx, writer, first.organization_id)
        .ok_or("writer profile missing")?;
    if writer_profile.is_superuser
        || !writer_profile.email.is_empty()
        || !writer_profile.platform_user_id.is_empty()
    {
        return Err("runtime enrollment copied human identity or superuser authority".into());
    }
    for (resource, action, expected) in [
        ("ai_spend", "reserve", true),
        ("ai_spend", "settle", true),
        ("ai_agent_run", "write", true),
        ("ai_agent", "write", false),
        ("sale_order", "create", false),
        ("permission", "create", false),
        ("ai_spend", "reconcile", false),
    ] {
        let allowed = resolve_permission(
            ctx,
            first.organization_id,
            writer,
            writer_role.id,
            &writer_role.name,
            &writer_role.permissions,
            false,
            resource,
            action,
        ) == PermissionResolution::Allow;
        if allowed != expected {
            return Err(format!(
                "runtime writer unexpected authority: {resource}:{action}"
            ));
        }
    }
    if resolve_permission(
        ctx,
        second.organization_id,
        writer,
        writer_role.id,
        &writer_role.name,
        &writer_role.permissions,
        false,
        "ai_spend",
        "reserve",
    ) == PermissionResolution::Allow
    {
        return Err("writer authority leaked across organizations".into());
    }
    if !crate::ai::platform_runtime::can_enroll_writer(
        ctx,
        second.organization_id,
        writer,
        template.id,
    ) {
        return Err("foreign organization history blocked a fresh runtime identity".into());
    }
    ctx.db.org_permission().insert(OrgPermission {
        id: 0,
        organization_id: second.organization_id,
        subject: PermissionSubject::User(writer),
        role_id: None,
        resource: "sale_order".into(),
        action: PermissionAction::Create,
        effect: PermissionEffect::Allow,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });
    if crate::ai::platform_runtime::can_enroll_writer(
        ctx,
        second.organization_id,
        writer,
        template.id,
    ) {
        return Err("runtime enrollment would activate a dormant business grant".into());
    }
    let source = ctx
        .db
        .company()
        .id()
        .find(first.company_id)
        .ok_or("company missing")?;
    let sibling = ctx.db.company().insert(Company {
        id: 0,
        external_id: format!("managed-test-{}", first.organization_id),
        code: "managed-sibling".into(),
        ..source
    });
    enroll_ai_company_defaults(ctx, first.organization_id, sibling.id)?;
    enroll_ai_company_defaults(ctx, first.organization_id, first.company_id)?;
    let budgets: Vec<_> = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_org()
        .filter(&first.organization_id)
        .collect();
    if budgets.len() != 1
        || ctx
            .db
            .ai_agent()
            .ai_agent_by_org()
            .filter(&first.organization_id)
            .count()
            != 1
    {
        return Err("company enrollment duplicated an agent or allowance".into());
    }
    if ctx
        .db
        .ai_skill_config()
        .ai_skill_config_by_org()
        .filter(&first.organization_id)
        .count()
        != 6
    {
        return Err("company bindings were missing or duplicated".into());
    }
    let mut budget = budgets[0].clone();
    budget.settled_units = 100;
    budget.outstanding_units = 200;
    ctx.db.ai_spend_budget().id().update(budget.clone());
    ensure_managed_period(ctx, first.organization_id, enrollment.agent_id)?;
    let after = ctx
        .db
        .ai_spend_budget()
        .id()
        .find(budget.id)
        .ok_or("budget missing")?;
    if after.settled_units != 100 || after.outstanding_units != 200 {
        return Err("renewal reset spend".into());
    }
    ctx.db.role().id().update(Role {
        is_active: false,
        ..writer_role
    });
    enroll_ai_company_defaults(ctx, first.organization_id, first.company_id)?;
    if ctx
        .db
        .role()
        .id()
        .find(membership.role_id)
        .ok_or("writer role missing")?
        .is_active
    {
        return Err("enrollment retry restored revoked writer access".into());
    }
    set_ai_agent_active(ctx, first.organization_id, enrollment.agent_id, false)?;
    enroll_ai_company_defaults(ctx, second.organization_id, second.company_id)?;
    if ctx
        .db
        .ai_managed_enrollment()
        .organization_id()
        .find(second.organization_id)
        .is_some()
    {
        return Err("disabled enrollment freed the historical sponsored cap".into());
    }
    set_ai_platform_default(ctx, None)?;
    enroll_ai_company_defaults(ctx, second.organization_id, second.company_id)?;
    if ctx
        .db
        .ai_agent()
        .ai_agent_by_org()
        .filter(&second.organization_id)
        .next()
        .is_some()
    {
        return Err("missing default created an agent".into());
    }
    // Restore deployment selection, not its configuration or funding.
    set_ai_platform_default(ctx, original_default)?;
    Ok(())
}
