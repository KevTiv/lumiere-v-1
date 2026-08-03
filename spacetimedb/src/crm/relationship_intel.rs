/// Relationship intelligence — bounded graph signals for customer-360.
///
/// Tables:
///   - ContactRelationshipInsight
///
/// Computes strength from active relationships + org hierarchy depth.
/// Does not invent enrichment from external providers.
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::crm::contacts::{contact, contact_relationship};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const MAX_RELATED_IDS: usize = 32;
const MAX_HIERARCHY_WALK: usize = 16;

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = contact_relationship_insight,
    index(accessor = rel_insight_by_org, btree(columns = [organization_id])),
    index(accessor = rel_insight_by_contact, btree(columns = [contact_id]))
)]
pub struct ContactRelationshipInsight {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub contact_id: u64,
    pub strength_score: i32,
    pub active_relationship_count: i32,
    pub hierarchy_depth: i32,
    pub related_contact_ids: Vec<u64>,
    pub summary: String,
    pub computed_at: Timestamp,
    pub computed_by: Identity,
    pub metadata: Option<String>,
    /// True when the source contact/relationships changed since
    /// `computed_at` and this snapshot no longer reflects them. Cleared by
    /// `recompute_relationship_insights`.
    pub is_stale: bool,
    /// When the insight was first flagged stale. `None` while fresh.
    pub stale_since: Option<Timestamp>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn hierarchy_depth(ctx: &ReducerContext, organization_id: u64, contact_id: u64) -> i32 {
    let mut depth = 0i32;
    let mut current = contact_id;
    for _ in 0..MAX_HIERARCHY_WALK {
        let Some(row) = ctx.db.contact().id().find(&current) else {
            break;
        };
        if row.organization_id != organization_id {
            break;
        }
        match row.parent_id {
            Some(parent) if parent != current => {
                depth += 1;
                current = parent;
            }
            _ => break,
        }
    }
    depth
}

/// Mark any existing relationship insight for `contact_id` as stale because
/// its source contact/relationships changed. Cheap, visible freshness
/// signal — does not recompute.
/// Callers: any reducer in `contacts.rs` that mutates `parent_id` (affects
/// `hierarchy_depth`) or creates/ends a `contact_relationship` row (affects
/// `active_relationship_count` / `related_contact_ids`) — e.g.
/// `update_contact_parent`, `create_contact_relationship`,
/// `end_contact_relationship`. When a relationship changes, both endpoint
/// contacts should be marked stale.
pub(crate) fn mark_relationship_insight_stale(
    ctx: &ReducerContext,
    organization_id: u64,
    contact_id: u64,
) {
    let ids: Vec<u64> = ctx
        .db
        .contact_relationship_insight()
        .rel_insight_by_contact()
        .filter(&contact_id)
        .filter(|r| r.organization_id == organization_id && !r.is_stale)
        .map(|r| r.id)
        .collect();
    for id in ids {
        if let Some(row) = ctx.db.contact_relationship_insight().id().find(&id) {
            ctx.db
                .contact_relationship_insight()
                .id()
                .update(ContactRelationshipInsight {
                    is_stale: true,
                    stale_since: Some(ctx.timestamp),
                    ..row
                });
        }
    }
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Recompute relationship intelligence for a single contact (replaces prior row).
#[spacetimedb::reducer]
pub fn recompute_relationship_insights(
    ctx: &ReducerContext,
    organization_id: u64,
    contact_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact", "read")?;

    let contact_row = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;
    if contact_row.organization_id != organization_id {
        return Err("Contact does not belong to this organization".to_string());
    }

    let old_ids: Vec<u64> = ctx
        .db
        .contact_relationship_insight()
        .rel_insight_by_contact()
        .filter(&contact_id)
        .filter(|r| r.organization_id == organization_id)
        .map(|r| r.id)
        .collect();
    for id in old_ids {
        ctx.db.contact_relationship_insight().id().delete(&id);
    }

    let mut related: Vec<u64> = Vec::new();
    for rel in ctx.db.contact_relationship().iter() {
        if rel.organization_id != organization_id || !rel.is_active {
            continue;
        }
        let other = if rel.left_contact_id == contact_id {
            Some(rel.right_contact_id)
        } else if rel.right_contact_id == contact_id {
            Some(rel.left_contact_id)
        } else {
            None
        };
        if let Some(other_id) = other {
            if !related.contains(&other_id) {
                related.push(other_id);
            }
        }
    }
    related.truncate(MAX_RELATED_IDS);

    let active_relationship_count = related.len() as i32;
    let depth = hierarchy_depth(ctx, organization_id, contact_id);
    let strength_score = (active_relationship_count * 15 + depth * 5).min(100).max(0);

    let summary = format!(
        "{active_relationship_count} active relationship(s), hierarchy depth {depth}, strength {strength_score}"
    );

    let insight = ctx
        .db
        .contact_relationship_insight()
        .insert(ContactRelationshipInsight {
            id: 0,
            organization_id,
            company_id: contact_row
                .company_id
                .ok_or("Contact has no company scope")?,
            contact_id,
            strength_score,
            active_relationship_count,
            hierarchy_depth: depth,
            related_contact_ids: related,
            summary: summary.clone(),
            computed_at: ctx.timestamp,
            computed_by: ctx.sender(),
            metadata: None,
            is_stale: false,
            stale_since: None,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "contact_relationship_insight",
            record_id: insight.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "contact_id": contact_id,
                    "strength_score": strength_score,
                    "active_relationship_count": active_relationship_count,
                    "hierarchy_depth": depth,
                })
                .to_string(),
            ),
            changed_fields: vec!["strength_score".to_string(), "summary".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
