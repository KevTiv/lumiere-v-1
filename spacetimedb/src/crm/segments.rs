/// Segments Module — Contact Segments & Assignment Rules
///
/// Tables:
///   - ContactSegment
///   - SegmentMember
///   - AssignmentRule
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::crm::contacts::contact;
use crate::helpers::check_permission;

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
    name: String,
    description: Option<String>,
    domain: Option<String>,
    is_dynamic: bool,
    // Additional optional fields
    color: Option<String>,
    parent_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact_segment", "create")?;

    if name.is_empty() {
        return Err("Segment name cannot be empty".to_string());
    }

    ctx.db.contact_segment().insert(ContactSegment {
        id: 0,
        organization_id,
        name,
        description,
        domain,
        is_dynamic,
        member_count: 0,
        color,
        parent_id,
        is_active: true,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        metadata: None,
    });

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

    let _contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;

    let already_member = ctx
        .db
        .segment_member()
        .iter()
        .any(|m| m.segment_id == segment_id && m.contact_id == contact_id && m.is_active);

    if already_member {
        return Err("Contact is already a member of this segment".to_string());
    }

    ctx.db.segment_member().insert(SegmentMember {
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

    Ok(())
}
