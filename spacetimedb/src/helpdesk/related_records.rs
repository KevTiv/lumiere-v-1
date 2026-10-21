//! Canonical Helpdesk business-record relation. The ticket remains organization-wide;
//! the relation owns an explicit company scope. Raw rows are private: only the
//! sender-authorized view exposes a typed model and canonical ID, never a stored URL.
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp, ViewContext};

use crate::accounting::journal_entries::{account_move, account_move__view};
use crate::core::organization::{company__view, require_company_in_organization};
use crate::core::permissions::{
    org_permission__view, role__view, PermissionAction, PermissionEffect, PermissionSubject,
};
use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::core::users::{user_organization, user_organization__view, user_profile__view};
use crate::helpdesk::tickets::{helpdesk_ticket, helpdesk_ticket__view};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::sales::sales_core::{sale_order, sale_order__view};

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum HelpdeskRelatedRecord {
    SaleOrder(u64),
    AccountMove(u64),
}

impl HelpdeskRelatedRecord {
    fn resource(&self) -> &'static str {
        match self {
            Self::SaleOrder(_) => "sale_order",
            Self::AccountMove(_) => "account_move",
        }
    }

    fn id(&self) -> u64 {
        match self {
            Self::SaleOrder(id) | Self::AccountMove(id) => *id,
        }
    }
}

/// One relation per ticket. Clearing removes the row; existing ticket params and
/// schema are unchanged. An existing relation cannot be moved across companies;
/// an authorized caller must clear it explicitly before a new company association.
#[spacetimedb::table(
    accessor = helpdesk_ticket_related_record,
    index(accessor = helpdesk_related_by_org, btree(columns = [organization_id])),
    index(accessor = helpdesk_related_by_company, btree(columns = [company_id]))
)]
pub struct HelpdeskTicketRelatedRecord {
    #[primary_key]
    pub ticket_id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub target: HelpdeskRelatedRecord,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct SetHelpdeskRelatedRecordParams {
    /// None explicitly clears the relation. No model or ID is inferred from text.
    pub target: Option<HelpdeskRelatedRecord>,
}

// ── Reducer ──────────────────────────────────────────────────────────────────

fn membership_company_matches(bound_company: Option<u64>, requested_company: u64) -> bool {
    requested_company > 0 && bound_company.is_none_or(|id| id == requested_company)
}

fn target_scope_matches(
    organization_id: u64,
    company_id: u64,
    target_organization_id: u64,
    target_company_id: u64,
) -> bool {
    organization_id > 0
        && company_id > 0
        && organization_id == target_organization_id
        && company_id == target_company_id
}

/// Set or explicitly clear a canonical reference after checking both resources.
#[spacetimedb::reducer]
pub fn set_helpdesk_related_record(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    ticket_id: u64,
    params: SetHelpdeskRelatedRecordParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "helpdesk_ticket", "write")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == organization_id && row.is_active)
        .ok_or("not a member of this organization")?;
    if !membership_company_matches(membership.company_id, company_id) {
        return Err("company is outside the caller's membership".to_string());
    }
    let ticket = ctx
        .db
        .helpdesk_ticket()
        .id()
        .find(&ticket_id)
        .ok_or("helpdesk ticket not found")?;
    if ticket.organization_id != organization_id || ticket.deleted_at.is_some() {
        return Err("helpdesk ticket is outside this organization or deleted".to_string());
    }
    let previous = ctx
        .db
        .helpdesk_ticket_related_record()
        .ticket_id()
        .find(&ticket_id);
    if previous.as_ref().is_some_and(|row| {
        !target_scope_matches(
            organization_id,
            company_id,
            row.organization_id,
            row.company_id,
        )
    }) {
        return Err("existing relation belongs to another company or organization".to_string());
    }

    let setting_target = params.target.is_some();
    let change = if let Some(target) = params.target {
        check_permission(ctx, organization_id, target.resource(), "read")?;
        if target.id() == 0 {
            return Err("related record id must be positive".to_string());
        }
        let scope = match &target {
            HelpdeskRelatedRecord::SaleOrder(id) => {
                let row = ctx
                    .db
                    .sale_order()
                    .id()
                    .find(id)
                    .ok_or("related sale order not found")?;
                (row.organization_id, row.company_id)
            }
            HelpdeskRelatedRecord::AccountMove(id) => {
                let row = ctx
                    .db
                    .account_move()
                    .id()
                    .find(id)
                    .ok_or("related account move not found")?;
                (row.organization_id, row.company_id)
            }
        };
        if !target_scope_matches(organization_id, company_id, scope.0, scope.1) {
            return Err("related record is outside this organization or company".to_string());
        }
        let relation = HelpdeskTicketRelatedRecord {
            ticket_id,
            organization_id,
            company_id,
            target,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        };
        let change = RowChange::upsert_stdb_row(
            "helpdesk_ticket_related_record",
            serde_json::json!({ "ticket_id": ticket_id }),
            &relation,
        )?;
        if previous.is_some() {
            ctx.db
                .helpdesk_ticket_related_record()
                .ticket_id()
                .update(relation);
        } else {
            ctx.db.helpdesk_ticket_related_record().insert(relation);
        }
        change
    } else {
        // Clearing needs the relation's company authorization, but never needs
        // target read access: a removed/restricted target must remain removable.
        ctx.db
            .helpdesk_ticket_related_record()
            .ticket_id()
            .delete(&ticket_id);
        RowChange::delete(
            "helpdesk_ticket_related_record",
            serde_json::json!({ "ticket_id": ticket_id }),
        )
    };
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.set_helpdesk_related_record".to_string(),
            correlation_id: format!("helpdesk-related-record:{ticket_id}"),
            changes: vec![change],
        },
    )?;
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "helpdesk_ticket_related_record",
            record_id: ticket_id,
            action: if setting_target { "UPDATE" } else { "DELETE" },
            old_values: None,
            new_values: None,
            changed_fields: vec!["target".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Sender-scoped read view ───────────────────────────────────────────────────

#[derive(SpacetimeType, Clone)]
pub struct HelpdeskRelatedRecordRead {
    pub ticket_id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub target: HelpdeskRelatedRecord,
}

/// Live permission resolution mirrors check_permission: role grants precede org
/// rules; otherwise an explicit org denial wins. Never use stale policy snapshots.
fn can_read(ctx: &ViewContext, organization_id: u64, role_id: u64, resource: &str) -> bool {
    let Some(profile) = ctx
        .db
        .user_profile()
        .user_profile_by_identity_organization()
        .filter((&ctx.sender(), &organization_id))
        .min_by_key(|row| row.id)
    else {
        return false;
    };
    if !profile.is_active {
        return false;
    }
    let Some(role) = ctx.db.role().id().find(&role_id) else {
        return false;
    };
    if role.organization_id != organization_id || !role.is_active {
        return false;
    }
    let role_granted = role.permissions.iter().any(|grant| {
        grant == "*:*" || grant == &format!("{resource}:*") || grant == &format!("{resource}:read")
    });
    let matching_effects = ctx
        .db
        .org_permission()
        .perm_by_org()
        .filter(&organization_id)
        .filter_map(|rule| {
            let subject_matches = match rule.subject {
                PermissionSubject::Role(id) => id == role_id,
                PermissionSubject::User(identity) => identity == ctx.sender(),
            };
            if !subject_matches
                || (rule.resource != "*" && rule.resource != resource)
                || !matches!(rule.action, PermissionAction::Read | PermissionAction::All)
            {
                return None;
            }
            Some(rule.effect)
        });
    read_grants_allow(profile.is_superuser, role_granted, matching_effects)
}

fn read_grants_allow(
    is_superuser: bool,
    role_granted: bool,
    matching_effects: impl Iterator<Item = PermissionEffect>,
) -> bool {
    if is_superuser || role_granted {
        return true;
    }
    let mut allowed = false;
    for effect in matching_effects {
        match effect {
            PermissionEffect::Deny => return false,
            PermissionEffect::Allow => allowed = true,
        }
    }
    allowed
}

/// No relation data is exposed after loss of ticket/target read permission.
/// Clients must treat absence as "no accessible relation", not proof no link exists.
#[spacetimedb::view(accessor = helpdesk_related_record_read, public, primary_key = ticket_id)]
pub fn helpdesk_related_record_read(ctx: &ViewContext) -> Vec<HelpdeskRelatedRecordRead> {
    let mut result = Vec::new();
    let mut seen_organizations = Vec::new();
    for membership in ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(ctx.sender())
    {
        if !membership.is_active || seen_organizations.contains(&membership.organization_id) {
            continue;
        }
        // check_permission resolves the first active membership in the organization.
        seen_organizations.push(membership.organization_id);
        if !can_read(
            ctx,
            membership.organization_id,
            membership.role_id,
            "helpdesk_ticket",
        ) {
            continue;
        }
        for relation in ctx
            .db
            .helpdesk_ticket_related_record()
            .helpdesk_related_by_org()
            .filter(&membership.organization_id)
        {
            if !membership_company_matches(membership.company_id, relation.company_id)
                || !can_read(
                    ctx,
                    relation.organization_id,
                    membership.role_id,
                    relation.target.resource(),
                )
            {
                continue;
            }
            let Some(company) = ctx.db.company().id().find(&relation.company_id) else {
                continue;
            };
            if company.organization_id != relation.organization_id || company.deleted_at.is_some() {
                continue;
            }
            let Some(ticket) = ctx.db.helpdesk_ticket().id().find(&relation.ticket_id) else {
                continue;
            };
            if ticket.organization_id != relation.organization_id || ticket.deleted_at.is_some() {
                continue;
            }
            let scope = match &relation.target {
                HelpdeskRelatedRecord::SaleOrder(id) => ctx
                    .db
                    .sale_order()
                    .id()
                    .find(id)
                    .map(|row| (row.organization_id, row.company_id)),
                HelpdeskRelatedRecord::AccountMove(id) => ctx
                    .db
                    .account_move()
                    .id()
                    .find(id)
                    .map(|row| (row.organization_id, row.company_id)),
            };
            if !scope.is_some_and(|(org, company)| {
                target_scope_matches(relation.organization_id, relation.company_id, org, company)
            }) || result
                .iter()
                .any(|row: &HelpdeskRelatedRecordRead| row.ticket_id == relation.ticket_id)
            {
                continue;
            }
            result.push(HelpdeskRelatedRecordRead {
                ticket_id: relation.ticket_id,
                organization_id: relation.organization_id,
                company_id: relation.company_id,
                target: relation.target,
            });
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restricted_membership_cannot_bind_other_company() {
        assert!(membership_company_matches(Some(2), 2));
        assert!(!membership_company_matches(Some(2), 3));
        assert!(membership_company_matches(None, 3));
        assert!(!membership_company_matches(None, 0));
    }

    #[test]
    fn target_requires_both_organization_and_company() {
        assert!(target_scope_matches(1, 2, 1, 2));
        assert!(!target_scope_matches(1, 2, 9, 2));
        assert!(!target_scope_matches(1, 2, 1, 9));
        assert!(!target_scope_matches(0, 2, 0, 2));
        assert!(!target_scope_matches(1, 0, 1, 0));
    }

    #[test]
    fn org_denial_wins_without_role_grant() {
        assert!(!read_grants_allow(false, false, [].into_iter()));
        assert!(read_grants_allow(
            false,
            false,
            [PermissionEffect::Allow].into_iter()
        ));
        assert!(!read_grants_allow(
            false,
            false,
            [PermissionEffect::Allow, PermissionEffect::Deny].into_iter()
        ));
        assert!(!read_grants_allow(
            false,
            false,
            [PermissionEffect::Deny, PermissionEffect::Allow].into_iter()
        ));
    }

    #[test]
    fn role_and_superuser_precedence_matches_existing_permission_resolver() {
        assert!(read_grants_allow(
            false,
            true,
            [PermissionEffect::Deny].into_iter()
        ));
        assert!(read_grants_allow(
            true,
            false,
            [PermissionEffect::Deny].into_iter()
        ));
    }
}
