//! Persisted personal-page composition, CAS, replay and authorization proofs.

use lumiere_presentation_core::{personal_page_key, PersonalPageModule, StoredPersonalPageLayout};
use serde_json::{json, Value};
use spacetimedb::{Identity, ReducerContext, Table};

use crate::{
    analytics::dashboards::{dashboard_widget, DashboardWidget},
    core::{
        audit::audit_log,
        organization::{company, Company},
        permissions::{
            org_permission, role, OrgPermission, PermissionAction, PermissionEffect,
            PermissionSubject, Role,
        },
        persistence::{organization_commit, organization_commit_cursor, organization_row_change},
        users::{
            find_user_profile_for_organization, user_organization, user_profile, UserOrganization,
            UserProfile,
        },
    },
    helpers::check_permission,
    presentation::{
        presentation_module, presentation_module_version, save_personal_page_layout,
        PresentationModule,
    },
    test_harness::OrgFixture,
    types::WidgetType,
};

fn definition(widgets: Vec<Value>) -> String {
    json!({"schemaVersion":1,"moduleId":"sales","pageId":"dashboard","widgets":widgets}).to_string()
}

fn builtin(id: &str, width: u8) -> Value {
    json!({"id":id,"source":"builtin","widgetId":format!("sales-{id}"),"width":width})
}

fn saved(widget_id: u64) -> String {
    definition(vec![
        json!({"id":"saved-chart","source":"saved","widgetId":widget_id.to_string(),"width":6}),
    ])
}

fn save(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    expected: Option<u64>,
    layout: String,
) -> Result<(), String> {
    save_personal_page_layout(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        "sales".into(),
        "dashboard".into(),
        expected,
        layout,
    )
}

/// Includes the replay-sensitive write surfaces, not fixture seed mutations.
fn state(ctx: &ReducerContext, organization_id: u64) -> (usize, usize, usize, usize, Option<u64>) {
    (
        ctx.db
            .presentation_module()
            .presentation_module_by_org()
            .filter(&organization_id)
            .count(),
        ctx.db
            .presentation_module_version()
            .presentation_module_version_by_org()
            .filter(&organization_id)
            .count(),
        ctx.db
            .audit_log()
            .iter()
            .filter(|row| row.organization_id == organization_id)
            .count(),
        ctx.db
            .organization_commit()
            .organization_commit_by_org()
            .filter(&organization_id)
            .count(),
        ctx.db
            .organization_commit_cursor()
            .organization_id()
            .find(&organization_id)
            .map(|row| row.next_sequence),
    )
}

pub fn test_personal_page_revision_replay_and_reset(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let first = definition(vec![builtin("first", 6), builtin("second", 6)]);
    save(ctx, &fixture, None, first.clone())?;
    let key = personal_page_key(fixture.company_id, PersonalPageModule::Sales, "dashboard")?;
    let head = ctx
        .db
        .presentation_module()
        .presentation_module_by_org()
        .filter(&fixture.organization_id)
        .find(|row| row.module_key == key)
        .ok_or("personal page head missing")?;
    let first_snapshot = ctx
        .db
        .presentation_module_version()
        .presentation_module_version_by_module()
        .filter(&head.id)
        .find(|row| row.revision == 1)
        .ok_or("personal page version missing")?;
    let committed = state(ctx, fixture.organization_id);
    save(ctx, &fixture, None, first)?;
    if state(ctx, fixture.organization_id) != committed {
        return Err("identical personal page retry produced duplicate writes".into());
    }
    let commit = ctx
        .db
        .organization_commit()
        .organization_commit_by_org()
        .filter(&fixture.organization_id)
        .max_by_key(|row| row.sequence)
        .ok_or("personal page commit missing")?;
    let changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_organization()
        .filter(&fixture.organization_id)
        .filter(|row| row.commit_sequence == commit.sequence)
        .map(|row| row.table_name)
        .collect();
    if commit.operation_id != "erp.save_personal_page_layout"
        || changes.len() != 3
        || ![
            "presentation_module",
            "presentation_module_version",
            "audit_log",
        ]
        .iter()
        .all(|table| changes.iter().any(|actual| actual == table))
    {
        return Err("personal page save lacks an atomic head/version/audit commit".into());
    }
    save(
        ctx,
        &fixture,
        Some(1),
        definition(vec![builtin("second", 4), builtin("first", 8)]),
    )?;
    let before_stale = state(ctx, fixture.organization_id);
    if save(
        ctx,
        &fixture,
        Some(1),
        definition(vec![builtin("stale", 12)]),
    )
    .is_ok()
        || state(ctx, fixture.organization_id) != before_stale
    {
        return Err("stale page edit was not rejected without writes".into());
    }
    save(ctx, &fixture, Some(2), "null".into())?;
    let reset_head = ctx
        .db
        .presentation_module()
        .id()
        .find(&head.id)
        .ok_or("personal page head disappeared")?;
    let versions: Vec<_> = ctx
        .db
        .presentation_module_version()
        .presentation_module_version_by_module()
        .filter(&head.id)
        .collect();
    let reset = versions
        .iter()
        .find(|row| row.revision == 3)
        .ok_or("reset version missing")?;
    let stored: StoredPersonalPageLayout =
        serde_json::from_str(&reset.definition_json).map_err(|error| error.to_string())?;
    if reset_head.current_revision != 3
        || versions.len() != 3
        || stored.layout.is_some()
        || versions
            .iter()
            .find(|row| row.revision == 1)
            .map(|row| &row.definition_json)
            != Some(&first_snapshot.definition_json)
    {
        return Err("reset erased history or mutated a previous layout".into());
    }
    let after_reset = state(ctx, fixture.organization_id);
    save(ctx, &fixture, Some(2), "null".into())?;
    if state(ctx, fixture.organization_id) != after_reset {
        return Err("reset retry duplicated an immutable version".into());
    }
    Ok(())
}

fn seed_widget(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    active: bool,
) -> u64 {
    ctx.db
        .dashboard_widget()
        .insert(DashboardWidget {
            id: 0,
            organization_id,
            name: "Sales metric".into(),
            widget_type: WidgetType::Chart,
            model: "account.move".into(),
            domain: None,
            fields: vec!["amount_total".into()],
            group_by: None,
            aggregation: Some("sum".into()),
            chart_type: Some("bar".into()),
            sort_order: None,
            limit: None,
            refresh_interval: None,
            configuration: None,
            position_x: 0,
            position_y: 0,
            width: 12,
            height: 1,
            is_active: active,
            company_id,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: None,
        })
        .id
}

pub fn test_personal_page_saved_widget_scope(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let other = OrgFixture::seed_minimal(ctx)?;
    let permitted = seed_widget(ctx, fixture.organization_id, Some(fixture.company_id), true);
    let organization_wide = seed_widget(ctx, fixture.organization_id, None, true);
    let foreign_org = seed_widget(ctx, other.organization_id, Some(other.company_id), true);
    let foreign_company = seed_widget(ctx, fixture.organization_id, Some(other.company_id), true);
    let inactive = seed_widget(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        false,
    );
    let before = state(ctx, fixture.organization_id);
    for id in [foreign_org, foreign_company, inactive, u64::MAX] {
        if save(ctx, &fixture, None, saved(id)).is_ok()
            || state(ctx, fixture.organization_id) != before
        {
            return Err("unavailable saved widget was accepted or partially persisted".into());
        }
    }
    if save_personal_page_layout(
        ctx,
        fixture.organization_id,
        other.company_id,
        "sales".into(),
        "dashboard".into(),
        None,
        definition(vec![builtin("total", 12)]),
    )
    .is_ok()
        || state(ctx, fixture.organization_id) != before
    {
        return Err("cross-company page scope was accepted or partially persisted".into());
    }
    save(ctx, &fixture, None, saved(permitted))?;
    save(ctx, &fixture, Some(1), saved(organization_wide))?;
    let row = ctx
        .db
        .dashboard_widget()
        .id()
        .find(&permitted)
        .ok_or("saved widget missing")?;
    if row.width != 12 || row.position_x != 0 || row.position_y != 0 {
        return Err("personal placement mutated the shared saved widget definition".into());
    }
    Ok(())
}

pub fn test_personal_page_current_read_permissions(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), fixture.organization_id)
        .ok_or("personal page profile missing")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..profile
    });
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == fixture.organization_id && row.is_active)
        .ok_or("personal page membership missing")?;
    let original_role = ctx
        .db
        .role()
        .id()
        .find(&membership.role_id)
        .ok_or("personal page role missing")?;
    ctx.db.role().id().update(Role {
        permissions: vec!["module:sales:read".into()],
        parent_id: None,
        ..original_role.clone()
    });
    if check_permission(ctx, fixture.organization_id, "presentation_module", "write").is_ok() {
        return Err("personal page reader unexpectedly has presentation administration".into());
    }
    let layout = definition(vec![builtin("total", 12)]);
    save(ctx, &fixture, None, layout.clone())?;
    let widget_id = seed_widget(ctx, fixture.organization_id, Some(fixture.company_id), true);
    let before = state(ctx, fixture.organization_id);
    if save(ctx, &fixture, Some(1), saved(widget_id)).is_ok()
        || state(ctx, fixture.organization_id) != before
    {
        return Err("saved widget definition permission was not enforced".into());
    }
    ctx.db.role().id().update(Role {
        permissions: vec!["module:sales:read".into(), "dashboard_widget:read".into()],
        parent_id: None,
        ..original_role.clone()
    });
    if save(ctx, &fixture, Some(1), saved(widget_id)).is_ok()
        || state(ctx, fixture.organization_id) != before
    {
        return Err("saved widget source permission was not enforced".into());
    }
    ctx.db.role().id().update(Role {
        permissions: vec![
            "module:sales:read".into(),
            "dashboard_widget:read".into(),
            "account_move:read".into(),
        ],
        parent_id: None,
        ..original_role
    });
    save(ctx, &fixture, Some(1), saved(widget_id))?;
    let deny = ctx.db.org_permission().insert(OrgPermission {
        id: 0,
        organization_id: fixture.organization_id,
        subject: PermissionSubject::User(ctx.sender()),
        role_id: None,
        resource: "module:sales".into(),
        action: PermissionAction::Read,
        effect: PermissionEffect::Deny,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });
    let before_denied = state(ctx, fixture.organization_id);
    if save(ctx, &fixture, Some(1), saved(widget_id)).is_ok()
        || state(ctx, fixture.organization_id) != before_denied
    {
        return Err("identical retry bypassed current module deny".into());
    }
    ctx.db.org_permission().id().delete(&deny.id);
    ctx.db.user_organization().id().update(UserOrganization {
        is_active: false,
        ..membership
    });
    if save(ctx, &fixture, Some(2), layout).is_ok()
        || state(ctx, fixture.organization_id) != before_denied
    {
        return Err("revoked membership could still update a personal page".into());
    }
    Ok(())
}

pub fn test_personal_page_owner_and_namespace_isolation(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let key = personal_page_key(fixture.company_id, PersonalPageModule::Sales, "dashboard")?;
    let other = Identity::from_byte_array([9; 32]);
    let foreign = ctx.db.presentation_module().insert(PresentationModule {
        id: 0,
        scope_key: format!("{}:{}:{key}", fixture.organization_id, other.to_hex()),
        organization_id: fixture.organization_id,
        owner_identity: other,
        module_key: key.clone(),
        current_revision: 4,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    // Exhaust the old generic-draft head quota; personal-page capacity is independent.
    for index in 0..100 {
        let module_key = format!("draft-{index}");
        ctx.db.presentation_module().insert(PresentationModule {
            id: 0,
            scope_key: format!(
                "{}:{}:{module_key}",
                fixture.organization_id,
                ctx.sender().to_hex()
            ),
            organization_id: fixture.organization_id,
            owner_identity: ctx.sender(),
            module_key,
            current_revision: 1,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        });
    }
    save(ctx, &fixture, None, definition(vec![builtin("total", 12)]))?;
    let heads: Vec<_> = ctx
        .db
        .presentation_module()
        .presentation_module_by_org()
        .filter(&fixture.organization_id)
        .filter(|row| row.module_key == key)
        .collect();
    if heads.len() != 2
        || !heads
            .iter()
            .any(|row| row.owner_identity == ctx.sender() && row.current_revision == 1)
        || ctx
            .db
            .presentation_module()
            .id()
            .find(&foreign.id)
            .map(|row| row.current_revision)
            != Some(4)
    {
        return Err("personal page owner scopes were not isolated".into());
    }
    Ok(())
}

pub fn test_personal_page_company_policy_matches_api(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), fixture.organization_id)
        .ok_or("personal page company test profile missing")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..profile
    });
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == fixture.organization_id && row.is_active)
        .ok_or("personal page company test membership missing")?;
    let role_id = membership.role_id;
    ctx.db.user_organization().id().update(UserOrganization {
        company_id: Some(fixture.company_id),
        ..membership
    });
    let first_company = ctx
        .db
        .company()
        .id()
        .find(&fixture.company_id)
        .ok_or("personal page company test company missing")?;
    let second_company = ctx.db.company().insert(Company {
        id: 0,
        external_id: format!("personal-page-test-{}", fixture.organization_id),
        name: "Second personal page company".into(),
        code: "PAGE-SECOND".into(),
        ..first_company
    });
    let layout = definition(vec![builtin("total", 12)]);
    // A bound owner with the existing explicit wildcard role may select a second
    // company, exactly as authorize_membership_company_ids permits in the API.
    save_personal_page_layout(
        ctx,
        fixture.organization_id,
        second_company.id,
        "sales".into(),
        "dashboard".into(),
        None,
        layout.clone(),
    )?;
    let before = state(ctx, fixture.organization_id);
    let deny = ctx.db.org_permission().insert(OrgPermission {
        id: 0,
        organization_id: fixture.organization_id,
        subject: PermissionSubject::User(ctx.sender()),
        role_id: None,
        resource: "module:sales".into(),
        action: PermissionAction::Read,
        effect: PermissionEffect::Deny,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });
    if save_personal_page_layout(
        ctx,
        fixture.organization_id,
        second_company.id,
        "sales".into(),
        "dashboard".into(),
        None,
        layout.clone(),
    )
    .is_ok()
        || state(ctx, fixture.organization_id) != before
    {
        return Err("wildcard company eligibility bypassed the current module deny".into());
    }
    ctx.db.org_permission().id().delete(&deny.id);
    let role = ctx
        .db
        .role()
        .id()
        .find(&role_id)
        .ok_or("personal page company test role missing")?;
    ctx.db.role().id().update(Role {
        permissions: vec!["module:sales:read".into()],
        ..role
    });
    if save_personal_page_layout(
        ctx,
        fixture.organization_id,
        second_company.id,
        "sales".into(),
        "dashboard".into(),
        Some(1),
        layout.clone(),
    )
    .is_ok()
        || state(ctx, fixture.organization_id) != before
    {
        return Err("ordinary bound member could edit another company's personal page".into());
    }
    save(ctx, &fixture, None, layout)?;
    Ok(())
}
