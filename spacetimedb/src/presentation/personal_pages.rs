//! Native owner-scoped preferences for approved existing page widgets.

use lumiere_presentation_core::{
    personal_page_widget_source_resource, prepare_personal_page_layout, PersonalPageLayout,
    PersonalPageModule, MAX_PERSONAL_PAGE_BYTES, PERSONAL_PAGE_CONTRACT,
};
use spacetimedb::{reducer, ReducerContext};

use super::{append_snapshot, SnapshotDefinition, WrittenSnapshot};
use crate::{
    analytics::dashboards::dashboard_widget,
    core::{
        organization::{organization, require_company_in_organization},
        permissions::effective_roles,
        persistence::{record_organization_commit, OrganizationCommitInput, RowChange},
        reconstruction::require_writes_unfenced,
        users::user_organization,
    },
    helpers::{check_permission, write_audit_log_v2_returning, AuditLogParams},
};

/// Match the API's existing reducer-company policy using current native rows.
/// A wildcard role widens company selection only after a unique live membership
/// and the module's current allow/deny policy have been checked.
fn require_page_company(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> Result<(), String> {
    let organization = ctx
        .db
        .organization()
        .id()
        .find(&organization_id)
        .ok_or("personal page organization is unavailable")?;
    if !organization.is_active {
        return Err("personal page organization is inactive".into());
    }
    require_company_in_organization(ctx, organization_id, company_id)?;
    // effective_roles rejects missing/ambiguous memberships, inactive base roles,
    // foreign roles and expired additive assignments.
    let roles = effective_roles(ctx, organization_id, ctx.sender())?;
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == organization_id && row.is_active)
        .ok_or("personal page requires active organization membership")?;
    if membership.company_id.is_none_or(|id| id == company_id)
        || roles.iter().any(|role| {
            role.permissions
                .iter()
                .any(|permission| permission == "*:*")
        })
    {
        Ok(())
    } else {
        Err("Permission denied: personal page company is outside current membership scope".into())
    }
}

/// Apply or reset the caller's inert layout for one existing company/module/page.
/// This API-only command does not publish generic presentation module drafts.
#[reducer]
pub fn save_personal_page_layout(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    module_id: String,
    page_id: String,
    expected_revision: Option<u64>,
    layout_json: String,
) -> Result<(), String> {
    let module = module_id.parse::<PersonalPageModule>()?;
    check_permission(ctx, organization_id, module.permission_resource(), "read")?;
    require_page_company(ctx, organization_id, company_id)?;
    require_writes_unfenced(ctx, organization_id)?;
    if layout_json.len() > MAX_PERSONAL_PAGE_BYTES || expected_revision == Some(0) {
        return Err("invalid personal page layout bounds or revision".into());
    }
    let layout: Option<PersonalPageLayout> = serde_json::from_str(&layout_json)
        .map_err(|error| format!("invalid personal page layout: {error}"))?;
    let prepared = prepare_personal_page_layout(company_id, module, &page_id, layout.as_ref())?;
    // Bindings are checked before persistence, including on an identical retry.
    // A saved ID cannot grant cross-company access or revive a disabled widget.
    if !prepared.saved_widget_ids.is_empty() {
        check_permission(ctx, organization_id, "dashboard_widget", "read")?;
        for widget_id in &prepared.saved_widget_ids {
            let widget = ctx
                .db
                .dashboard_widget()
                .id()
                .find(widget_id)
                .ok_or("saved widget is unavailable for this page")?;
            if widget.organization_id != organization_id
                || widget.company_id.is_some_and(|id| id != company_id)
                || !widget.is_active
            {
                return Err("saved widget is unavailable for this page".into());
            }
            check_permission(
                ctx,
                organization_id,
                &personal_page_widget_source_resource(&widget.model),
                "read",
            )?;
        }
    }
    let Some(WrittenSnapshot { head, version }) = append_snapshot(
        ctx,
        organization_id,
        expected_revision,
        SnapshotDefinition {
            module_key: &prepared.module_key,
            definition_json: &prepared.definition_json,
            schema_version: 1,
            application_contract: PERSONAL_PAGE_CONTRACT,
            component_catalog_version: 1,
        },
        true,
    )?
    else {
        return Ok(());
    };
    let audit = write_audit_log_v2_returning(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "presentation_module_version",
            record_id: version.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "moduleId": module_id, "pageId": page_id, "revision": version.revision,
                    "definitionHash": version.definition_hash, "reset": layout.is_none(),
                })
                .to_string(),
            ),
            changed_fields: vec!["personal_page_layout".into(), "revision".into()],
            metadata: Some("personal page preferences; no generic module publication".into()),
        },
    );
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.save_personal_page_layout".into(),
            correlation_id: head.scope_key.clone(),
            changes: vec![
                RowChange::upsert_stdb_row(
                    "presentation_module",
                    serde_json::json!({"id": head.id}),
                    &head,
                )?,
                RowChange::upsert_stdb_row(
                    "presentation_module_version",
                    serde_json::json!({"id": version.id}),
                    &version,
                )?,
                RowChange::upsert_stdb_row(
                    "audit_log",
                    serde_json::json!({"id": audit.id}),
                    &audit,
                )?,
            ],
        },
    )?;
    Ok(())
}
