/// Segments Module — Contact Segments & Assignment Rules
///
/// Tables:
///   - ContactSegment
///   - SegmentMember
///   - AssignmentRule
///   - ContactSegmentRule (bounded dynamic-segment AST)
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::crm::contacts::{contact, contact_tag_assignment, Contact};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

/// Hard cap so dynamic evaluation stays bounded in-reducer.
pub const MAX_SEGMENT_RULES: usize = 16;
/// Cap contacts scanned / membership flips per evaluate call.
pub const MAX_SEGMENT_EVAL_CONTACTS: usize = 500;

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

/// Indexed fields allowed in the dynamic segment AST (not arbitrary expressions).
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum SegmentRuleField {
    CountryCode,
    City,
    Industry,
    IsCustomer,
    IsProspect,
    IsVendor,
    TagId,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum SegmentRuleOp {
    Eq,
    Neq,
    Contains,
    IsTrue,
    IsFalse,
}

/// One clause in a contact-segment rule AST (AND-combined at evaluate time).
#[derive(SpacetimeType, Clone, Debug)]
pub struct SegmentRuleClause {
    pub field: SegmentRuleField,
    pub op: SegmentRuleOp,
    pub value_text: Option<String>,
    pub value_id: Option<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SetContactSegmentRulesParams {
    pub replace_all: bool,
    pub rules: Vec<SegmentRuleClause>,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// TABLES: SEGMENTS
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = contact_segment,
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

#[spacetimedb::table(accessor = segment_member)]
pub struct SegmentMember {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub segment_id: u64,
    pub contact_id: u64,
    pub added_at: Timestamp,
    pub added_by: Identity,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = assignment_rule,
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

#[spacetimedb::table(
    accessor = contact_segment_rule,
    index(accessor = segment_rule_by_org, btree(columns = [organization_id])),
    index(accessor = segment_rule_by_segment, btree(columns = [segment_id]))
)]
pub struct ContactSegmentRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub segment_id: u64,
    pub sequence: i32,
    pub field: SegmentRuleField,
    pub op: SegmentRuleOp,
    pub value_text: Option<String>,
    pub value_id: Option<u64>,
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
        company_id: contact.company_id.ok_or("Contact has no company scope")?,
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

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: DYNAMIC SEGMENT RULE AST
// ══════════════════════════════════════════════════════════════════════════════

fn validate_clause(clause: &SegmentRuleClause) -> Result<(), String> {
    match (&clause.field, &clause.op) {
        (
            SegmentRuleField::CountryCode | SegmentRuleField::City | SegmentRuleField::Industry,
            SegmentRuleOp::Eq | SegmentRuleOp::Neq | SegmentRuleOp::Contains,
        ) => {
            if clause.value_text.as_ref().is_none_or(|v| v.is_empty()) {
                return Err("Text rule clauses require value_text".to_string());
            }
        }
        (
            SegmentRuleField::IsCustomer
            | SegmentRuleField::IsProspect
            | SegmentRuleField::IsVendor,
            SegmentRuleOp::IsTrue | SegmentRuleOp::IsFalse,
        ) => {}
        (SegmentRuleField::TagId, SegmentRuleOp::Eq | SegmentRuleOp::Neq) => {
            if clause.value_id.is_none() {
                return Err("TagId clauses require value_id".to_string());
            }
        }
        _ => {
            return Err("Unsupported field/operator combination for segment rule".to_string());
        }
    }
    Ok(())
}

fn contact_matches_clause(
    ctx: &ReducerContext,
    contact: &Contact,
    clause: &ContactSegmentRule,
) -> bool {
    match clause.field {
        SegmentRuleField::CountryCode => {
            let actual = contact.country_code.as_deref().unwrap_or("");
            match_text(
                actual,
                &clause.op,
                clause.value_text.as_deref().unwrap_or(""),
            )
        }
        SegmentRuleField::City => {
            let actual = contact.city.as_deref().unwrap_or("");
            match_text(
                actual,
                &clause.op,
                clause.value_text.as_deref().unwrap_or(""),
            )
        }
        SegmentRuleField::Industry => {
            let actual = contact.industry.as_deref().unwrap_or("");
            match_text(
                actual,
                &clause.op,
                clause.value_text.as_deref().unwrap_or(""),
            )
        }
        SegmentRuleField::IsCustomer => match_bool(contact.is_customer, &clause.op),
        SegmentRuleField::IsProspect => match_bool(contact.is_prospect, &clause.op),
        SegmentRuleField::IsVendor => match_bool(contact.is_vendor, &clause.op),
        SegmentRuleField::TagId => {
            let tag_id = clause.value_id.unwrap_or(0);
            let has_tag = ctx
                .db
                .contact_tag_assignment()
                .iter()
                .any(|a| a.contact_id == contact.id && a.tag_id == tag_id);
            match clause.op {
                SegmentRuleOp::Eq => has_tag,
                SegmentRuleOp::Neq => !has_tag,
                _ => false,
            }
        }
    }
}

fn match_text(actual: &str, op: &SegmentRuleOp, expected: &str) -> bool {
    let a = actual.to_lowercase();
    let e = expected.to_lowercase();
    match op {
        SegmentRuleOp::Eq => a == e,
        SegmentRuleOp::Neq => a != e,
        SegmentRuleOp::Contains => a.contains(&e),
        _ => false,
    }
}

fn match_bool(actual: bool, op: &SegmentRuleOp) -> bool {
    match op {
        SegmentRuleOp::IsTrue => actual,
        SegmentRuleOp::IsFalse => !actual,
        _ => false,
    }
}

/// Replace (or append) bounded AST clauses for a dynamic segment.
#[spacetimedb::reducer]
pub fn set_contact_segment_rules(
    ctx: &ReducerContext,
    organization_id: u64,
    segment_id: u64,
    params: SetContactSegmentRulesParams,
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
    if !segment.is_dynamic {
        return Err("Rules can only be set on dynamic segments".to_string());
    }
    if params.rules.len() > MAX_SEGMENT_RULES {
        return Err(format!(
            "A segment may have at most {MAX_SEGMENT_RULES} rule clauses"
        ));
    }
    for clause in &params.rules {
        validate_clause(clause)?;
    }

    if params.replace_all {
        let old_ids: Vec<u64> = ctx
            .db
            .contact_segment_rule()
            .segment_rule_by_segment()
            .filter(&segment_id)
            .filter(|r| r.organization_id == organization_id)
            .map(|r| r.id)
            .collect();
        for id in old_ids {
            ctx.db.contact_segment_rule().id().delete(&id);
        }
    }

    let start_seq = if params.replace_all {
        0
    } else {
        ctx.db
            .contact_segment_rule()
            .segment_rule_by_segment()
            .filter(&segment_id)
            .map(|r| r.sequence)
            .max()
            .unwrap_or(-1)
            + 1
    };

    for (i, clause) in params.rules.iter().enumerate() {
        ctx.db.contact_segment_rule().insert(ContactSegmentRule {
            id: 0,
            organization_id,
            segment_id,
            sequence: start_seq + i as i32,
            field: clause.field.clone(),
            op: clause.op.clone(),
            value_text: clause.value_text.clone(),
            value_id: clause.value_id,
            created_at: ctx.timestamp,
            metadata: params.metadata.clone(),
        });
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "contact_segment_rule",
            record_id: segment_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "segment_id": segment_id,
                    "rule_count": params.rules.len(),
                    "replace_all": params.replace_all,
                })
                .to_string(),
            ),
            changed_fields: vec!["rules".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Evaluate dynamic segment membership against the stored rule AST (AND).
/// Bounded scan: up to `MAX_SEGMENT_EVAL_CONTACTS` org contacts per call.
#[spacetimedb::reducer]
pub fn evaluate_dynamic_segment(
    ctx: &ReducerContext,
    organization_id: u64,
    segment_id: u64,
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
    if !segment.is_dynamic {
        return Err("Only dynamic segments can be evaluated".to_string());
    }

    let rules: Vec<ContactSegmentRule> = ctx
        .db
        .contact_segment_rule()
        .segment_rule_by_segment()
        .filter(&segment_id)
        .filter(|r| r.organization_id == organization_id)
        .collect();
    if rules.is_empty() {
        return Err("Dynamic segment has no rules to evaluate".to_string());
    }

    let contacts: Vec<Contact> = ctx
        .db
        .contact()
        .contact_by_org()
        .filter(&organization_id)
        .take(MAX_SEGMENT_EVAL_CONTACTS)
        .collect();

    let mut matched_ids = Vec::new();
    for contact in &contacts {
        if rules
            .iter()
            .all(|rule| contact_matches_clause(ctx, contact, rule))
        {
            matched_ids.push(contact.id);
        }
    }

    // Deactivate members no longer matching
    for member in ctx.db.segment_member().iter() {
        if member.organization_id != organization_id
            || member.segment_id != segment_id
            || !member.is_active
        {
            continue;
        }
        if !matched_ids.contains(&member.contact_id) {
            ctx.db.segment_member().id().update(SegmentMember {
                is_active: false,
                ..member
            });
        }
    }

    // Activate / insert matches
    for contact_id in &matched_ids {
        let existing = ctx.db.segment_member().iter().find(|m| {
            m.organization_id == organization_id
                && m.segment_id == segment_id
                && m.contact_id == *contact_id
        });
        match existing {
            Some(member) if !member.is_active => {
                ctx.db.segment_member().id().update(SegmentMember {
                    is_active: true,
                    added_at: ctx.timestamp,
                    added_by: ctx.sender(),
                    ..member
                });
            }
            Some(_) => {}
            None => {
                let company_id = contacts
                    .iter()
                    .find(|contact| contact.id == *contact_id)
                    .and_then(|contact| contact.company_id)
                    .ok_or("Contact has no company scope")?;
                ctx.db.segment_member().insert(SegmentMember {
                    id: 0,
                    organization_id,
                    company_id,
                    segment_id,
                    contact_id: *contact_id,
                    added_at: ctx.timestamp,
                    added_by: ctx.sender(),
                    is_active: true,
                    metadata: Some(r#"{"source":"dynamic_eval"}"#.to_string()),
                });
            }
        }
    }

    let active_count = ctx
        .db
        .segment_member()
        .iter()
        .filter(|m| {
            m.organization_id == organization_id && m.segment_id == segment_id && m.is_active
        })
        .count() as i32;

    ctx.db.contact_segment().id().update(ContactSegment {
        member_count: active_count,
        ..segment
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "contact_segment",
            record_id: segment_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "member_count": active_count,
                    "matched_in_scan": matched_ids.len(),
                    "scanned": contacts.len(),
                })
                .to_string(),
            ),
            changed_fields: vec!["member_count".to_string()],
            metadata: Some(r#"{"action":"evaluate_dynamic_segment"}"#.to_string()),
        },
    );

    Ok(())
}
