/// Segments Module — Contact Segments & Assignment Rules
///
/// Tables:
///   - ContactSegment
///   - SegmentMember
///   - AssignmentRule
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::crm::contacts::contact;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ══════════════════════════════════════════════════════════════════════════════
// PARAMS TYPES
// ══════════════════════════════════════════════════════════════════════════════

/// Params for creating a contact segment.
/// Scope: `organization_id` is a flat reducer param (not in this struct).
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateContactSegmentParams {
    pub name: String,
    pub is_dynamic: bool,
    pub is_active: bool,
    pub description: Option<String>,
    pub domain: Option<String>,
    pub color: Option<String>,
    pub parent_id: Option<u64>,
    pub metadata: Option<String>,
}

/// Params for creating an assignment rule.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAssignmentRuleParams {
    pub name: String,
    pub model: String,
    pub domain: Option<String>,
    pub assign_type: String,
    pub user_ids: Vec<Identity>,
    pub team_id: Option<u64>,
    pub priority: i32,
    pub is_active: bool,
    pub metadata: Option<String>,
}

/// Params for updating an assignment rule. `None` = keep existing value.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAssignmentRuleParams {
    pub name: Option<String>,
    pub model: Option<String>,
    pub domain: Option<String>,
    pub assign_type: Option<String>,
    pub user_ids: Option<Vec<Identity>>,
    pub team_id: Option<u64>,
    pub priority: Option<i32>,
    pub is_active: Option<bool>,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// TABLES: SEGMENTS
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = contact_segment,
    public,
    index(accessor = segment_by_org, btree(columns = [organization_id]))
)]
pub struct ContactSegment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub domain: Option<String>,
    pub is_dynamic: bool,
    pub member_count: i32,
    pub color: Option<String>,
    pub parent_id: Option<u64>,
    pub is_active: bool,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(accessor = segment_member, public)]
pub struct SegmentMember {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub segment_id: u64,
    pub contact_id: u64,
    pub added_at: Timestamp,
    pub added_by: Identity,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = assignment_rule,
    public,
    index(accessor = rule_by_org, btree(columns = [organization_id]))
)]
pub struct AssignmentRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub model: String,
    pub domain: Option<String>,
    pub assign_type: String,
    pub user_ids: Vec<Identity>,
    pub team_id: Option<u64>,
    pub priority: i32,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: SEGMENT MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_contact_segment(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateContactSegmentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact_segment", "create")?;

    if params.name.is_empty() {
        return Err("Segment name cannot be empty".to_string());
    }

    let segment = ctx.db.contact_segment().insert(ContactSegment {
        id: 0,
        organization_id,
        name: params.name,
        description: params.description,
        domain: params.domain,
        is_dynamic: params.is_dynamic,
        // System-managed: always starts at 0, incremented by add_contact_to_segment
        member_count: 0,
        color: params.color,
        parent_id: params.parent_id,
        is_active: params.is_active,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "contact_segment",
            record_id: segment.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": segment.name,
                    "is_dynamic": segment.is_dynamic,
                    "is_active": segment.is_active,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "is_dynamic".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn add_contact_to_segment(
    ctx: &ReducerContext,
    organization_id: u64,
    segment_id: u64,
    contact_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact_segment", "write")?;

    let segment = ctx
        .db
        .contact_segment()
        .id()
        .find(&segment_id)
        .ok_or("Segment not found")?;
    if segment.organization_id != organization_id {
        return Err("Segment does not belong to this organization".to_string());
    }

    let contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;
    if contact.organization_id != organization_id {
        return Err("Contact does not belong to this organization".to_string());
    }

    let already_member = ctx
        .db
        .segment_member()
        .iter()
        .any(|m| m.segment_id == segment_id && m.contact_id == contact_id && m.is_active);

    if already_member {
        return Err("Contact is already a member of this segment".to_string());
    }

    let member = ctx.db.segment_member().insert(SegmentMember {
        id: 0,
        organization_id,
        segment_id,
        contact_id,
        added_at: ctx.timestamp,
        added_by: ctx.sender(),
        is_active: true,
        metadata: None,
    });

    ctx.db.contact_segment().id().update(ContactSegment {
        member_count: segment.member_count + 1,
        ..segment
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "segment_member",
            record_id: member.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "segment_id": segment_id,
                    "contact_id": contact_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["segment_id".to_string(), "contact_id".to_string()],
            metadata: Some(
                serde_json::json!({
                    "junction": "segment_member",
                    "segment_member_count_updated": segment.member_count + 1,
                })
                .to_string(),
            ),
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: ASSIGNMENT RULE ADMIN
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_assignment_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAssignmentRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "assignment_rule", "create")?;

    if params.name.is_empty() {
        return Err("Rule name cannot be empty".to_string());
    }

    let rule = ctx.db.assignment_rule().insert(AssignmentRule {
        id: 0,
        organization_id,
        name: params.name.clone(),
        model: params.model,
        domain: params.domain,
        assign_type: params.assign_type,
        user_ids: params.user_ids,
        team_id: params.team_id,
        priority: params.priority,
        is_active: params.is_active,
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "assignment_rule",
            record_id: rule.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": params.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_assignment_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    rule_id: u64,
    params: UpdateAssignmentRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "assignment_rule", "write")?;

    let rule = ctx
        .db
        .assignment_rule()
        .id()
        .find(&rule_id)
        .ok_or("Assignment rule not found")?;

    if rule.organization_id != organization_id {
        return Err("Assignment rule does not belong to this organization".to_string());
    }

    let mut changed_fields = Vec::new();

    let name = match params.name {
        Some(v) => {
            if v.is_empty() {
                return Err("Rule name cannot be empty".to_string());
            }
            changed_fields.push("name".to_string());
            v
        }
        None => rule.name.clone(),
    };
    let model = match params.model {
        Some(v) => {
            changed_fields.push("model".to_string());
            v
        }
        None => rule.model.clone(),
    };
    if params.domain.is_some() {
        changed_fields.push("domain".to_string());
    }
    let domain = params.domain.or_else(|| rule.domain.clone());
    let assign_type = match params.assign_type {
        Some(v) => {
            changed_fields.push("assign_type".to_string());
            v
        }
        None => rule.assign_type.clone(),
    };
    let user_ids_changed = params.user_ids.is_some();
    let user_ids = params.user_ids.unwrap_or_else(|| rule.user_ids.clone());
    if user_ids_changed {
        changed_fields.push("user_ids".to_string());
    }
    let team_id = params.team_id.or(rule.team_id);
    if params.team_id.is_some() {
        changed_fields.push("team_id".to_string());
    }
    let priority = params.priority.unwrap_or(rule.priority);
    if params.priority.is_some() {
        changed_fields.push("priority".to_string());
    }
    let is_active = params.is_active.unwrap_or(rule.is_active);
    if params.is_active.is_some() {
        changed_fields.push("is_active".to_string());
    }
    if params.metadata.is_some() {
        changed_fields.push("metadata".to_string());
    }
    let metadata = params.metadata.or_else(|| rule.metadata.clone());

    ctx.db.assignment_rule().id().update(AssignmentRule {
        name,
        model,
        domain,
        assign_type,
        user_ids,
        team_id,
        priority,
        is_active,
        metadata,
        ..rule
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "assignment_rule",
            record_id: rule_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}
