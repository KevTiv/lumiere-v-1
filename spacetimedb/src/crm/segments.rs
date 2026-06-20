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
