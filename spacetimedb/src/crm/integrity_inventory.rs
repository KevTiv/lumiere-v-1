//! CRM relational-integrity inventory (Phase 0 — Containment).
//!
//! Read-only diagnostic for `docs/plans/crm-relational-integrity-remediation-plan.md`
//! section 7 ("Data migration and quarantine"). This module never inserts,
//! updates, or deletes any row. It only iterates existing tables, counts
//! violations, and logs a structured report via `log::info!`/`log::warn!` so
//! it can be captured with `spacetime logs <db>`.
//!
//! Run with:
//! ```text
//! spacetime call <db> crm_integrity_inventory
//! spacetime logs <db>
//! ```
//!
//! Re-run after any remediation phase lands to confirm violation counts have
//! dropped to zero for P0 categories (plan section 7, item 7).

use std::collections::{HashMap, HashSet};

use spacetimedb::{ReducerContext, Table};

use crate::crm::contact_identities::{contact_identity_verification_proof, contact_phone_identity};
use crate::crm::contacts::{
    contact, contact_category, contact_category_assignment, contact_relationship, contact_tag,
    contact_tag_assignment,
};
use crate::crm::inbox::{crm_conversation, crm_conversation_message};
use crate::crm::leads::{lead, lead_lost_reason, lead_source};
use crate::crm::opportunities::{opp_stage, opportunity, opportunity_line};
use crate::crm::segments::{contact_segment, segment_member};
use crate::sales::sales_core::sale_order;
use crate::types::ContactVerificationState;

const MAX_SAMPLES: usize = 5;

/// One detected violation category, ready to render as a report line.
struct Finding {
    category: &'static str,
    description: &'static str,
    count: usize,
    sample_ids: Vec<u64>,
}

impl Finding {
    fn new(category: &'static str, description: &'static str, ids: Vec<u64>) -> Self {
        let count = ids.len();
        let mut sample_ids = ids;
        sample_ids.truncate(MAX_SAMPLES);
        Self {
            category,
            description,
            count,
            sample_ids,
        }
    }

    fn log(&self) {
        if self.count == 0 {
            log::info!(
                "[crm-integrity] category={} count=0 sample_ids=[] -- {}",
                self.category,
                self.description
            );
        } else {
            log::warn!(
                "[crm-integrity] category={} count={} sample_ids={:?} -- {}",
                self.category,
                self.count,
                self.sample_ids,
                self.description
            );
        }
    }
}

/// Zero-like sentinel or missing-required-ID checks across CRM relation fields.
fn check_zero_and_missing_ids(ctx: &ReducerContext) -> Finding {
    let mut ids = Vec::new();

    for c in ctx.db.contact().iter() {
        if c.parent_id == Some(0) {
            ids.push(c.id);
        }
    }
    for l in ctx.db.lead().iter() {
        if l.source_id == Some(0)
            || l.campaign_id == Some(0)
            || l.team_id == Some(0)
            || l.partner_id == Some(0)
            || l.lost_reason_id == Some(0)
        {
            ids.push(l.id);
        }
    }
    for o in ctx.db.opportunity().iter() {
        if o.stage_id == 0
            || o.lead_id == Some(0)
            || o.partner_id == Some(0)
            || o.contact_id == Some(0)
            || o.lost_reason_id == Some(0)
        {
            ids.push(o.id);
        }
    }
    for line in ctx.db.opportunity_line().iter() {
        if line.opportunity_id == 0 || line.product_id == Some(0) {
            ids.push(line.id);
        }
    }
    for so in ctx.db.sale_order().iter() {
        if so.opportunity_id == Some(0) {
            ids.push(so.id);
        }
    }

    Finding::new(
        "zero_and_missing_ids",
        "relation fields holding sentinel 0 instead of None/a real ID (contact.parent_id, lead source/campaign/team/partner/lost_reason, opportunity stage/lead/partner/contact/lost_reason, opportunity_line.opportunity_id/product_id, sale_order.opportunity_id)",
        ids,
    )
}

/// Foreign-key-like fields whose target row does not exist.
fn check_dangling_relations(ctx: &ReducerContext) -> Finding {
    let mut ids = Vec::new();

    let contact_ids: HashSet<u64> = ctx.db.contact().iter().map(|c| c.id).collect();
    let opp_ids: HashSet<u64> = ctx.db.opportunity().iter().map(|o| o.id).collect();
    let stage_ids: HashSet<u64> = ctx.db.opp_stage().iter().map(|s| s.id).collect();
    let lead_ids: HashSet<u64> = ctx.db.lead().iter().map(|l| l.id).collect();
    let lead_source_ids: HashSet<u64> = ctx.db.lead_source().iter().map(|s| s.id).collect();
    let lost_reason_ids: HashSet<u64> = ctx.db.lead_lost_reason().iter().map(|r| r.id).collect();
    let segment_ids: HashSet<u64> = ctx.db.contact_segment().iter().map(|s| s.id).collect();
    let tag_ids: HashSet<u64> = ctx.db.contact_tag().iter().map(|t| t.id).collect();
    let category_ids: HashSet<u64> = ctx.db.contact_category().iter().map(|c| c.id).collect();
    let phone_identity_ids: HashSet<u64> = ctx
        .db
        .contact_phone_identity()
        .iter()
        .map(|p| p.id)
        .collect();
    let conversation_ids: HashSet<u64> = ctx.db.crm_conversation().iter().map(|c| c.id).collect();

    for c in ctx.db.contact().iter() {
        if let Some(parent_id) = c.parent_id {
            if parent_id != 0 && !contact_ids.contains(&parent_id) {
                ids.push(c.id);
            }
        }
    }
    for rel in ctx.db.contact_relationship().iter() {
        if !contact_ids.contains(&rel.left_contact_id)
            || !contact_ids.contains(&rel.right_contact_id)
        {
            ids.push(rel.id);
        }
    }
    for l in ctx.db.lead().iter() {
        let dangling = l
            .source_id
            .is_some_and(|id| id != 0 && !lead_source_ids.contains(&id))
            || l.partner_id
                .is_some_and(|id| id != 0 && !contact_ids.contains(&id))
            || l.lost_reason_id
                .is_some_and(|id| id != 0 && !lost_reason_ids.contains(&id));
        if dangling {
            ids.push(l.id);
        }
    }
    for o in ctx.db.opportunity().iter() {
        let dangling = !stage_ids.contains(&o.stage_id)
            || o.lead_id
                .is_some_and(|id| id != 0 && !lead_ids.contains(&id))
            || o.partner_id
                .is_some_and(|id| id != 0 && !contact_ids.contains(&id))
            || o.contact_id
                .is_some_and(|id| id != 0 && !contact_ids.contains(&id))
            || o.lost_reason_id
                .is_some_and(|id| id != 0 && !lost_reason_ids.contains(&id));
        if dangling {
            ids.push(o.id);
        }
    }
    for line in ctx.db.opportunity_line().iter() {
        if !opp_ids.contains(&line.opportunity_id) {
            ids.push(line.id);
        }
    }
    for so in ctx.db.sale_order().iter() {
        if so
            .opportunity_id
            .is_some_and(|id| id != 0 && !opp_ids.contains(&id))
        {
            ids.push(so.id);
        }
    }
    for identity in ctx.db.contact_phone_identity().iter() {
        if !contact_ids.contains(&identity.contact_id) {
            ids.push(identity.id);
        }
    }
    for convo in ctx.db.crm_conversation().iter() {
        let dangling = !contact_ids.contains(&convo.contact_id)
            || convo
                .phone_identity_id
                .is_some_and(|id| !phone_identity_ids.contains(&id));
        if dangling {
            ids.push(convo.id);
        }
    }
    for msg in ctx.db.crm_conversation_message().iter() {
        if !conversation_ids.contains(&msg.conversation_id) {
            ids.push(msg.id);
        }
    }
    for member in ctx.db.segment_member().iter() {
        if !segment_ids.contains(&member.segment_id) || !contact_ids.contains(&member.contact_id) {
            ids.push(member.id);
        }
    }
    for assignment in ctx.db.contact_tag_assignment().iter() {
        if !contact_ids.contains(&assignment.contact_id) || !tag_ids.contains(&assignment.tag_id) {
            ids.push(assignment.id);
        }
    }
    for assignment in ctx.db.contact_category_assignment().iter() {
        if !contact_ids.contains(&assignment.contact_id)
            || !category_ids.contains(&assignment.category_id)
        {
            ids.push(assignment.id);
        }
    }

    Finding::new(
        "dangling_relations",
        "relation IDs that point at a row absent from the target table (contact parent/relationship, lead source/partner/lost_reason, opportunity stage/lead/partner/contact/lost_reason, opportunity_line, sale_order.opportunity_id, phone identities, conversations/messages, segment members, tag/category assignments)",
        ids,
    )
}

/// Cross-organization or cross-company references between a CRM row and its parent/child.
fn check_cross_org_company(ctx: &ReducerContext) -> Finding {
    let mut ids = Vec::new();

    let contacts_by_id: HashMap<u64, (u64, Option<u64>)> = ctx
        .db
        .contact()
        .iter()
        .map(|c| (c.id, (c.organization_id, c.company_id)))
        .collect();
    let opps_by_id: HashMap<u64, u64> = ctx
        .db
        .opportunity()
        .iter()
        .map(|o| (o.id, o.organization_id))
        .collect();

    for c in ctx.db.contact().iter() {
        if let Some(parent_id) = c.parent_id {
            if let Some((parent_org, _)) = contacts_by_id.get(&parent_id) {
                if *parent_org != c.organization_id {
                    ids.push(c.id);
                }
            }
        }
    }
    for l in ctx.db.lead().iter() {
        if let Some(partner_id) = l.partner_id {
            if let Some((partner_org, _)) = contacts_by_id.get(&partner_id) {
                if *partner_org != l.organization_id {
                    ids.push(l.id);
                }
            }
        }
    }
    for o in ctx.db.opportunity().iter() {
        for related in [o.partner_id, o.contact_id] {
            if let Some(rel_id) = related {
                if let Some((rel_org, rel_company)) = contacts_by_id.get(&rel_id) {
                    if *rel_org != o.organization_id {
                        ids.push(o.id);
                    }
                    if let (Some(opp_company), Some(rel_company)) = (o.company_id, rel_company) {
                        if opp_company != *rel_company {
                            ids.push(o.id);
                        }
                    }
                }
            }
        }
    }
    for so in ctx.db.sale_order().iter() {
        if let Some(opp_id) = so.opportunity_id {
            if let Some(opp_org) = opps_by_id.get(&opp_id) {
                if *opp_org != so.organization_id {
                    ids.push(so.id);
                }
            }
        }
        if let Some((partner_org, partner_company)) = contacts_by_id.get(&so.partner_id) {
            if *partner_org != so.organization_id {
                ids.push(so.id);
            }
            if partner_company.is_some_and(|company| company != so.company_id) {
                ids.push(so.id);
            }
        }
    }
    for identity in ctx.db.contact_phone_identity().iter() {
        if let Some((contact_org, contact_company)) = contacts_by_id.get(&identity.contact_id) {
            if *contact_org != identity.organization_id {
                ids.push(identity.id);
            }
            if let (Some(identity_company), Some(contact_company)) =
                (identity.company_id, contact_company)
            {
                if identity_company != *contact_company {
                    ids.push(identity.id);
                }
            }
        }
    }

    ids.sort_unstable();
    ids.dedup();

    Finding::new(
        "cross_org_company",
        "a CRM row's parent/child reference belongs to a different organization or company than the row itself (contact parent, lead partner, opportunity partner/contact, sale_order opportunity/partner, phone identity company)",
        ids,
    )
}

/// Live relations that still target a contact which is soft-deleted or merged away.
fn check_deleted_or_merged_contact_targets(ctx: &ReducerContext) -> Finding {
    let mut ids = Vec::new();

    let retired_contacts: HashSet<u64> = ctx
        .db
        .contact()
        .iter()
        .filter(|c| c.deleted_at.is_some() || c.merge_target_id.is_some())
        .map(|c| c.id)
        .collect();
    if retired_contacts.is_empty() {
        return Finding::new(
            "deleted_or_merged_contact_targets",
            "live relations pointing at a soft-deleted or merged-away contact",
            ids,
        );
    }

    for c in ctx.db.contact().iter() {
        if let Some(parent_id) = c.parent_id {
            if c.deleted_at.is_none()
                && c.merge_target_id.is_none()
                && retired_contacts.contains(&parent_id)
            {
                ids.push(c.id);
            }
        }
    }
    for l in ctx.db.lead().iter() {
        if let Some(partner_id) = l.partner_id {
            if l.deleted_at.is_none() && retired_contacts.contains(&partner_id) {
                ids.push(l.id);
            }
        }
    }
    for o in ctx.db.opportunity().iter() {
        let targets_retired = o
            .partner_id
            .is_some_and(|id| retired_contacts.contains(&id))
            || o.contact_id
                .is_some_and(|id| retired_contacts.contains(&id));
        if o.deleted_at.is_none() && targets_retired {
            ids.push(o.id);
        }
    }
    for rel in ctx.db.contact_relationship().iter() {
        if rel.is_active
            && (retired_contacts.contains(&rel.left_contact_id)
                || retired_contacts.contains(&rel.right_contact_id))
        {
            ids.push(rel.id);
        }
    }
    for convo in ctx.db.crm_conversation().iter() {
        if retired_contacts.contains(&convo.contact_id) {
            ids.push(convo.id);
        }
    }
    for member in ctx.db.segment_member().iter() {
        if member.is_active && retired_contacts.contains(&member.contact_id) {
            ids.push(member.id);
        }
    }
    for so in ctx.db.sale_order().iter() {
        if retired_contacts.contains(&so.partner_id) {
            ids.push(so.id);
        }
    }

    Finding::new(
        "deleted_or_merged_contact_targets",
        "live relations pointing at a soft-deleted or merged-away contact (contact parent, lead partner, opportunity partner/contact, contact_relationship, conversations, segment members, sale_order partner)",
        ids,
    )
}

/// CRM-RI-011: opportunity lifecycle flags that contradict each other or the linked stage.
fn check_contradictory_opportunity_state(ctx: &ReducerContext) -> Finding {
    let mut ids = Vec::new();
    let stage_is_won: HashMap<u64, bool> = ctx
        .db
        .opp_stage()
        .iter()
        .map(|s| (s.id, s.is_won))
        .collect();

    for o in ctx.db.opportunity().iter() {
        if o.is_won && o.is_lost {
            ids.push(o.id);
            continue;
        }
        if let Some(stage_won) = stage_is_won.get(&o.stage_id) {
            if o.is_won && !stage_won {
                ids.push(o.id);
            }
        }
    }

    ids.sort_unstable();
    ids.dedup();

    Finding::new(
        "contradictory_opportunity_state",
        "opportunity.is_won and is_lost both true, or is_won true while the linked stage is not a won stage",
        ids,
    )
}

/// CRM-RI-005: more than one sale_order referencing the same opportunity_id.
fn check_duplicate_sales_orders_per_opportunity(ctx: &ReducerContext) -> Finding {
    let mut by_opportunity: HashMap<u64, Vec<u64>> = HashMap::new();
    for so in ctx.db.sale_order().iter() {
        if let Some(opp_id) = so.opportunity_id {
            by_opportunity.entry(opp_id).or_default().push(so.id);
        }
    }

    let mut ids: Vec<u64> = by_opportunity
        .into_values()
        .filter(|orders| orders.len() > 1)
        .flatten()
        .collect();
    ids.sort_unstable();

    Finding::new(
        "duplicate_sales_orders_per_opportunity",
        "sale_order rows (ids listed) sharing the same opportunity_id",
        ids,
    )
}

/// CRM-RI-006: contact parent chains that loop back to themselves.
fn check_contact_hierarchy_cycles(ctx: &ReducerContext) -> Finding {
    let parent_of: HashMap<u64, u64> = ctx
        .db
        .contact()
        .iter()
        .filter_map(|c| c.parent_id.map(|p| (c.id, p)))
        .collect();

    let mut ids = Vec::new();
    for &start in parent_of.keys() {
        let mut seen = HashSet::new();
        let mut current = start;
        let mut cyclic = false;
        loop {
            if !seen.insert(current) {
                cyclic = true;
                break;
            }
            match parent_of.get(&current) {
                Some(&next) => current = next,
                None => break,
            }
            if seen.len() > parent_of.len() + 1 {
                cyclic = true;
                break;
            }
        }
        if cyclic {
            ids.push(start);
        }
    }
    ids.sort_unstable();

    Finding::new(
        "contact_hierarchy_cycles",
        "contact.id values whose parent_id chain loops back on itself",
        ids,
    )
}

/// Duplicate association rows and stale stored counts.
fn check_duplicate_associations_and_stale_counts(ctx: &ReducerContext) -> Finding {
    let mut ids = Vec::new();

    let mut tag_pairs: HashMap<(u64, u64), Vec<u64>> = HashMap::new();
    for a in ctx.db.contact_tag_assignment().iter() {
        tag_pairs
            .entry((a.contact_id, a.tag_id))
            .or_default()
            .push(a.id);
    }
    for rows in tag_pairs.into_values() {
        if rows.len() > 1 {
            ids.extend(rows);
        }
    }

    let mut category_pairs: HashMap<(u64, u64), Vec<u64>> = HashMap::new();
    for a in ctx.db.contact_category_assignment().iter() {
        category_pairs
            .entry((a.contact_id, a.category_id))
            .or_default()
            .push(a.id);
    }
    for rows in category_pairs.into_values() {
        if rows.len() > 1 {
            ids.extend(rows);
        }
    }

    let mut active_segment_pairs: HashMap<(u64, u64), Vec<u64>> = HashMap::new();
    for m in ctx.db.segment_member().iter().filter(|m| m.is_active) {
        active_segment_pairs
            .entry((m.segment_id, m.contact_id))
            .or_default()
            .push(m.id);
    }
    for rows in active_segment_pairs.into_values() {
        if rows.len() > 1 {
            ids.extend(rows);
        }
    }

    let mut active_counts: HashMap<u64, i32> = HashMap::new();
    for m in ctx.db.segment_member().iter().filter(|m| m.is_active) {
        *active_counts.entry(m.segment_id).or_insert(0) += 1;
    }
    for segment in ctx.db.contact_segment().iter() {
        let live = active_counts.get(&segment.id).copied().unwrap_or(0);
        if segment.member_count != live {
            ids.push(segment.id);
        }
    }

    ids.sort_unstable();
    ids.dedup();

    Finding::new(
        "duplicate_associations_and_stale_counts",
        "duplicate contact/tag, contact/category, or active segment-member pairs, plus contact_segment.member_count values that disagree with live active segment_member rows",
        ids,
    )
}

/// CRM-RI-008: identity verification metadata that is internally inconsistent or unverifiable.
fn check_forged_identity_verification(ctx: &ReducerContext) -> Finding {
    let mut ids = Vec::new();

    let mut proofs_by_identity: HashMap<u64, Vec<(Option<u64>, u64, String)>> = HashMap::new();
    for proof in ctx.db.contact_identity_verification_proof().iter() {
        proofs_by_identity
            .entry(proof.identity_id)
            .or_default()
            .push((proof.company_id, proof.contact_id, proof.normalized_e164));
    }

    let contact_companies: HashMap<u64, Option<u64>> = ctx
        .db
        .contact()
        .iter()
        .map(|c| (c.id, c.company_id))
        .collect();

    for identity in ctx.db.contact_phone_identity().iter() {
        let has_current_proof = proofs_by_identity.get(&identity.id).is_some_and(|proofs| {
            proofs.iter().any(|(company_id, contact_id, normalized)| {
                *company_id == identity.company_id
                    && *contact_id == identity.contact_id
                    && *normalized == identity.normalized_e164
            })
        });
        let verified_without_proof = matches!(
            identity.verification_state,
            ContactVerificationState::Verified
        ) && (identity.verified_at.is_none() || !has_current_proof);

        let company_mismatch = match (
            identity.company_id,
            contact_companies.get(&identity.contact_id),
        ) {
            (Some(identity_company), Some(Some(contact_company))) => {
                identity_company != *contact_company
            }
            _ => false,
        };

        if verified_without_proof || company_mismatch {
            ids.push(identity.id);
        }
    }

    ids.sort_unstable();

    Finding::new(
        "forged_identity_verification",
        "contact_phone_identity rows marked Verified without a verified_at timestamp and immutable provider proof, or whose company_id does not match the owning contact's company_id",
        ids,
    )
}

/// Run the full read-only CRM integrity inventory and log a structured report.
///
/// Does not mutate any row. Safe to re-run at any time, including after each
/// remediation phase, to confirm violation counts have dropped to zero.
#[spacetimedb::reducer]
pub fn crm_integrity_inventory(ctx: &ReducerContext) -> Result<(), String> {
    log::info!("[crm-integrity] === CRM relational-integrity inventory: start ===");

    let findings = [
        check_zero_and_missing_ids(ctx),
        check_dangling_relations(ctx),
        check_cross_org_company(ctx),
        check_deleted_or_merged_contact_targets(ctx),
        check_contradictory_opportunity_state(ctx),
        check_duplicate_sales_orders_per_opportunity(ctx),
        check_contact_hierarchy_cycles(ctx),
        check_duplicate_associations_and_stale_counts(ctx),
        check_forged_identity_verification(ctx),
    ];

    let mut total_violations = 0usize;
    for finding in &findings {
        finding.log();
        total_violations += finding.count;
    }

    log::info!(
        "[crm-integrity] === CRM relational-integrity inventory: done -- categories={} total_violations={} ===",
        findings.len(),
        total_violations
    );

    Ok(())
}
