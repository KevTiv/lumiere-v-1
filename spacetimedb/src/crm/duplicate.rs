/// Contact duplicate detection and merge — complements import wizard duplicate warnings.
use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};

use crate::crm::activities::calendar_event;
use crate::crm::contact_identities::{contact_phone_identity, ContactPhoneIdentity};
use crate::crm::contact_roles::{contact_role_assignment, ContactRoleAssignment};
use crate::crm::contacts::{
    contact, contact_category_assignment, contact_relationship, contact_tag_assignment, Contact,
};
use crate::crm::inbox::{crm_conversation, CrmConversation};
use crate::crm::leads::lead;
use crate::crm::opportunities::opportunity;
use crate::crm::relationship_intel::{contact_relationship_insight, ContactRelationshipInsight};
use crate::crm::segments::{contact_segment, segment_member, ContactSegment};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::sales::sales_core::sale_order;

/// Maximum ancestor-chain hops walked when checking for a contact hierarchy cycle.
/// Bounds the walk so a pre-existing corrupt cycle cannot loop forever.
const MAX_HIERARCHY_WALK: usize = 1000;

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = contact_duplicate_candidate,
    index(accessor = dup_by_org_company, btree(columns = [organization_id, company_id]))
)]
pub struct ContactDuplicateCandidate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub contact_id_a: u64,
    pub contact_id_b: u64,
    pub match_reason: String,
    pub scanned_at: Timestamp,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct MergeContactsParams {
    pub target_contact_id: u64,
}

// ── Query helpers ─────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DuplicateContactPair {
    pub contact_id_a: u64,
    pub contact_id_b: u64,
    pub match_reason: String,
}

fn norm(value: Option<&String>) -> String {
    value.map(|s| s.trim().to_lowercase()).unwrap_or_default()
}

fn contact_phone(c: &Contact) -> String {
    let phone = norm(c.phone.as_ref());
    if !phone.is_empty() {
        return phone;
    }
    norm(c.mobile.as_ref())
}

fn contact_name(c: &Contact) -> String {
    norm(Some(&c.name))
}

fn is_active_contact(c: &Contact) -> bool {
    c.deleted_at.is_none() && c.merge_target_id.is_none()
}

fn contact_in_company(c: &Contact, organization_id: u64, company_id: u64) -> bool {
    c.organization_id == organization_id && c.company_id == Some(company_id) && is_active_contact(c)
}

fn duplicate_match_reason(a: &Contact, b: &Contact) -> Option<String> {
    let email_a = norm(a.email.as_ref());
    let email_b = norm(b.email.as_ref());
    if !email_a.is_empty() && email_a == email_b {
        return Some("email".to_string());
    }

    let name_a = contact_name(a);
    let name_b = contact_name(b);
    let phone_a = contact_phone(a);
    let phone_b = contact_phone(b);
    if !name_a.is_empty() && !phone_a.is_empty() && name_a == name_b && phone_a == phone_b {
        return Some("name + phone".to_string());
    }

    None
}

/// Scan active contacts in company scope and return duplicate pairs (canonical id order).
pub fn find_duplicate_contact_pairs(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> Vec<DuplicateContactPair> {
    let contacts: Vec<Contact> = ctx
        .db
        .contact()
        .iter()
        .filter(|c| contact_in_company(c, organization_id, company_id))
        .collect();

    let mut pairs = Vec::new();
    for i in 0..contacts.len() {
        for j in (i + 1)..contacts.len() {
            let a = &contacts[i];
            let b = &contacts[j];
            if let Some(reason) = duplicate_match_reason(a, b) {
                let (id_a, id_b) = if a.id < b.id {
                    (a.id, b.id)
                } else {
                    (b.id, a.id)
                };
                pairs.push(DuplicateContactPair {
                    contact_id_a: id_a,
                    contact_id_b: id_b,
                    match_reason: reason,
                });
            }
        }
    }
    pairs
}

fn ensure_contact_company(contact: &Contact, company_id: u64) -> Result<(), String> {
    if contact.company_id != Some(company_id) {
        return Err("Record does not belong to this company".to_string());
    }
    Ok(())
}

/// Returns true if merging `source_contact_id` into `target_contact_id` would create
/// a contact hierarchy cycle.
///
/// The specific failure mode this guards against: if `target_contact_id` is currently
/// a descendant of `source_contact_id` (i.e. `source_contact_id` appears in the ancestor
/// chain walked up from `target_contact_id`), then the "repoint child contacts" step of
/// the merge would repoint some contact's `parent_id` from `source_contact_id` to
/// `target_contact_id` — and if that contact IS the target itself, the target would
/// become its own parent. More generally, any such configuration would fold the source's
/// position in the hierarchy back onto the target, creating a cycle. Walks a bounded
/// number of hops so a pre-existing corrupt parent chain cannot loop forever; hitting the
/// bound is treated as unsafe.
fn would_create_contact_cycle(
    ctx: &ReducerContext,
    source_contact_id: u64,
    target_contact_id: u64,
) -> bool {
    let mut current = target_contact_id;
    for _ in 0..MAX_HIERARCHY_WALK {
        if current == source_contact_id {
            return true;
        }
        let Some(row) = ctx.db.contact().id().find(&current) else {
            return false;
        };
        match row.parent_id {
            Some(parent) if parent != current => current = parent,
            _ => return false,
        }
    }
    // Bound exceeded — either a very deep chain or a pre-existing cycle. Either way,
    // it is not safe to reason about, so reject the merge.
    true
}

fn repoint_option_id(value: Option<u64>, source_id: u64, target_id: u64) -> Option<u64> {
    if value == Some(source_id) {
        Some(target_id)
    } else {
        value
    }
}

fn merge_option_field<T: Clone>(target: &Option<T>, source: &Option<T>) -> Option<T> {
    if target.is_some() {
        target.clone()
    } else {
        source.clone()
    }
}

fn merge_contact_fields(target: &Contact, source: &Contact) -> Contact {
    Contact {
        email: merge_option_field(&target.email, &source.email),
        email_secondary: merge_option_field(&target.email_secondary, &source.email_secondary),
        phone: merge_option_field(&target.phone, &source.phone),
        mobile: merge_option_field(&target.mobile, &source.mobile),
        fax: merge_option_field(&target.fax, &source.fax),
        website: merge_option_field(&target.website, &source.website),
        first_name: merge_option_field(&target.first_name, &source.first_name),
        last_name: merge_option_field(&target.last_name, &source.last_name),
        title: merge_option_field(&target.title, &source.title),
        street: merge_option_field(&target.street, &source.street),
        street2: merge_option_field(&target.street2, &source.street2),
        city: merge_option_field(&target.city, &source.city),
        state_code: merge_option_field(&target.state_code, &source.state_code),
        zip: merge_option_field(&target.zip, &source.zip),
        country_code: merge_option_field(&target.country_code, &source.country_code),
        tax_id: merge_option_field(&target.tax_id, &source.tax_id),
        company_registry: merge_option_field(&target.company_registry, &source.company_registry),
        industry: merge_option_field(&target.industry, &source.industry),
        employees_count: target.employees_count.or(source.employees_count),
        annual_revenue: target.annual_revenue.or(source.annual_revenue),
        description: merge_option_field(&target.description, &source.description),
        color: merge_option_field(&target.color, &source.color),
        is_customer: target.is_customer || source.is_customer,
        is_vendor: target.is_vendor || source.is_vendor,
        is_employee: target.is_employee || source.is_employee,
        is_prospect: target.is_prospect || source.is_prospect,
        is_partner: target.is_partner || source.is_partner,
        customer_rank: target.customer_rank.max(source.customer_rank),
        supplier_rank: target.supplier_rank.max(source.supplier_rank),
        salesperson_id: target.salesperson_id.or(source.salesperson_id),
        assigned_user_id: target.assigned_user_id.or(source.assigned_user_id),
        user_id: target.user_id.or(source.user_id),
        updated_at: target.updated_at,
        ..target.clone()
    }
}

// ── Reducers ──────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn find_duplicate_contacts(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact", "read")?;

    let pairs = find_duplicate_contact_pairs(ctx, organization_id, company_id);

    let stale: Vec<u64> = ctx
        .db
        .contact_duplicate_candidate()
        .iter()
        .filter(|row| row.organization_id == organization_id && row.company_id == company_id)
        .map(|row| row.id)
        .collect();
    for id in stale {
        ctx.db.contact_duplicate_candidate().id().delete(&id);
    }

    for pair in &pairs {
        ctx.db
            .contact_duplicate_candidate()
            .insert(ContactDuplicateCandidate {
                id: 0,
                organization_id,
                company_id,
                contact_id_a: pair.contact_id_a,
                contact_id_b: pair.contact_id_b,
                match_reason: pair.match_reason.clone(),
                scanned_at: ctx.timestamp,
            });
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "contact_duplicate_candidate",
            record_id: 0,
            action: "SCAN",
            old_values: None,
            new_values: Some(serde_json::json!({ "pair_count": pairs.len() }).to_string()),
            changed_fields: vec!["pair_count".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn merge_contacts(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    source_contact_id: u64,
    params: MergeContactsParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact", "write")?;

    if source_contact_id == params.target_contact_id {
        return Err("Cannot merge a contact into itself".to_string());
    }

    let source = ctx
        .db
        .contact()
        .id()
        .find(&source_contact_id)
        .ok_or("Source contact not found")?;
    let target = ctx
        .db
        .contact()
        .id()
        .find(&params.target_contact_id)
        .ok_or("Target contact not found")?;

    if source.organization_id != organization_id || target.organization_id != organization_id {
        return Err("Contact does not belong to this organization".to_string());
    }
    ensure_contact_company(&source, company_id)?;
    ensure_contact_company(&target, company_id)?;

    if !is_active_contact(&source) {
        return Err("Source contact is already merged or deleted".to_string());
    }
    if !is_active_contact(&target) {
        return Err("Target contact is not active".to_string());
    }

    if would_create_contact_cycle(ctx, source_contact_id, params.target_contact_id) {
        return Err("cannot merge: would create a contact hierarchy cycle".to_string());
    }

    let source_name = source.name.clone();
    let target_name = target.name.clone();

    let mut opportunities_repointed: u64 = 0;
    let mut leads_repointed: u64 = 0;
    let mut sale_orders_repointed: u64 = 0;
    let mut calendar_events_repointed: u64 = 0;
    let mut segment_members_repointed: u64 = 0;
    let mut tag_assignments_repointed: u64 = 0;
    let mut category_assignments_repointed: u64 = 0;
    let mut relationships_repointed: u64 = 0;
    let mut child_contacts_repointed: u64 = 0;
    let mut phone_identities_repointed: u64 = 0;
    let mut role_assignments_repointed: u64 = 0;
    let mut conversations_repointed: u64 = 0;
    let mut relationship_insights_repointed: u64 = 0;
    let mut segments_recomputed: u64 = 0;

    // Repoint opportunities
    for opp in ctx.db.opportunity().iter() {
        if opp.organization_id != organization_id {
            continue;
        }
        let new_partner =
            repoint_option_id(opp.partner_id, source_contact_id, params.target_contact_id);
        let new_contact =
            repoint_option_id(opp.contact_id, source_contact_id, params.target_contact_id);
        if new_partner != opp.partner_id || new_contact != opp.contact_id {
            ctx.db
                .opportunity()
                .id()
                .update(crate::crm::opportunities::Opportunity {
                    partner_id: new_partner,
                    contact_id: new_contact,
                    ..opp
                });
            opportunities_repointed += 1;
        }
    }

    // Repoint leads
    for lead_row in ctx.db.lead().iter() {
        if lead_row.organization_id != organization_id {
            continue;
        }
        let new_partner = repoint_option_id(
            lead_row.partner_id,
            source_contact_id,
            params.target_contact_id,
        );
        if new_partner != lead_row.partner_id {
            ctx.db.lead().id().update(crate::crm::leads::Lead {
                partner_id: new_partner,
                ..lead_row
            });
            leads_repointed += 1;
        }
    }

    // Repoint sale orders (partner + invoice + shipping)
    for order in ctx.db.sale_order().iter() {
        if order.organization_id != organization_id {
            continue;
        }
        let mut partner_id = order.partner_id;
        let mut partner_invoice_id = order.partner_invoice_id;
        let mut partner_shipping_id = order.partner_shipping_id;
        if partner_id == source_contact_id {
            partner_id = params.target_contact_id;
        }
        if partner_invoice_id == source_contact_id {
            partner_invoice_id = params.target_contact_id;
        }
        if partner_shipping_id == source_contact_id {
            partner_shipping_id = params.target_contact_id;
        }
        let mut message_partner_ids = order.message_partner_ids.clone();
        for id in message_partner_ids.iter_mut() {
            if *id == source_contact_id {
                *id = params.target_contact_id;
            }
        }
        if partner_id != order.partner_id
            || partner_invoice_id != order.partner_invoice_id
            || partner_shipping_id != order.partner_shipping_id
            || message_partner_ids != order.message_partner_ids
        {
            ctx.db
                .sale_order()
                .id()
                .update(crate::sales::sales_core::SaleOrder {
                    partner_id,
                    partner_invoice_id,
                    partner_shipping_id,
                    message_partner_ids,
                    ..order
                });
            sale_orders_repointed += 1;
        }
    }

    // Repoint calendar events
    for event in ctx.db.calendar_event().iter() {
        if event.organization_id != organization_id {
            continue;
        }
        let mut partner_ids = event.partner_ids.clone();
        let mut changed = false;
        for id in partner_ids.iter_mut() {
            if *id == source_contact_id {
                *id = params.target_contact_id;
                changed = true;
            }
        }
        if changed {
            ctx.db
                .calendar_event()
                .id()
                .update(crate::crm::activities::CalendarEvent {
                    partner_ids,
                    ..event
                });
            calendar_events_repointed += 1;
        }
    }

    // Repoint segment members — skip if target already in segment
    let mut affected_segment_ids: Vec<u64> = Vec::new();
    for member in ctx.db.segment_member().iter() {
        if member.organization_id != organization_id || member.contact_id != source_contact_id {
            continue;
        }
        if !affected_segment_ids.contains(&member.segment_id) {
            affected_segment_ids.push(member.segment_id);
        }
        let target_exists = ctx.db.segment_member().iter().any(|m| {
            m.organization_id == organization_id
                && m.segment_id == member.segment_id
                && m.contact_id == params.target_contact_id
                && m.is_active
        });
        if target_exists {
            ctx.db.segment_member().id().delete(&member.id);
        } else {
            ctx.db
                .segment_member()
                .id()
                .update(crate::crm::segments::SegmentMember {
                    contact_id: params.target_contact_id,
                    ..member
                });
        }
        segment_members_repointed += 1;
    }

    // Recompute denormalized member_count for every segment touched above, since the
    // dedup-and-delete path above can silently shrink the active-member count.
    for segment_id in &affected_segment_ids {
        if let Some(segment) = ctx.db.contact_segment().id().find(segment_id) {
            let active_count = ctx
                .db
                .segment_member()
                .iter()
                .filter(|m| {
                    m.organization_id == organization_id
                        && m.segment_id == *segment_id
                        && m.is_active
                })
                .count() as i32;
            if active_count != segment.member_count {
                ctx.db.contact_segment().id().update(ContactSegment {
                    member_count: active_count,
                    ..segment
                });
                segments_recomputed += 1;
            }
        }
    }

    // Repoint tag assignments
    for assignment in ctx.db.contact_tag_assignment().iter() {
        if assignment.organization_id != organization_id
            || assignment.contact_id != source_contact_id
        {
            continue;
        }
        let target_has_tag = ctx.db.contact_tag_assignment().iter().any(|a| {
            a.organization_id == organization_id
                && a.contact_id == params.target_contact_id
                && a.tag_id == assignment.tag_id
        });
        if target_has_tag {
            ctx.db.contact_tag_assignment().id().delete(&assignment.id);
        } else {
            ctx.db.contact_tag_assignment().id().update(
                crate::crm::contacts::ContactTagAssignment {
                    contact_id: params.target_contact_id,
                    ..assignment
                },
            );
        }
        tag_assignments_repointed += 1;
    }

    // Repoint category assignments
    for assignment in ctx.db.contact_category_assignment().iter() {
        if assignment.organization_id != organization_id
            || assignment.contact_id != source_contact_id
        {
            continue;
        }
        let target_has = ctx.db.contact_category_assignment().iter().any(|a| {
            a.organization_id == organization_id
                && a.contact_id == params.target_contact_id
                && a.category_id == assignment.category_id
        });
        if target_has {
            ctx.db
                .contact_category_assignment()
                .id()
                .delete(&assignment.id);
        } else {
            ctx.db.contact_category_assignment().id().update(
                crate::crm::contacts::ContactCategoryAssignment {
                    contact_id: params.target_contact_id,
                    ..assignment
                },
            );
        }
        category_assignments_repointed += 1;
    }

    // Repoint relationships
    for rel in ctx.db.contact_relationship().iter() {
        if rel.organization_id != organization_id {
            continue;
        }
        let new_left = if rel.left_contact_id == source_contact_id {
            params.target_contact_id
        } else {
            rel.left_contact_id
        };
        let new_right = if rel.right_contact_id == source_contact_id {
            params.target_contact_id
        } else {
            rel.right_contact_id
        };
        if new_left != rel.left_contact_id || new_right != rel.right_contact_id {
            if new_left == new_right {
                ctx.db.contact_relationship().id().delete(&rel.id);
            } else {
                ctx.db.contact_relationship().id().update(
                    crate::crm::contacts::ContactRelationship {
                        left_contact_id: new_left,
                        right_contact_id: new_right,
                        ..rel
                    },
                );
            }
            relationships_repointed += 1;
        }
    }

    // Repoint child contacts (parent_id).
    // Note: the cycle check above already rejects merges where `target_contact_id`
    // would end up parented to itself here (i.e. where target is a descendant of
    // source); this per-row guard is a defense-in-depth no-op skip in case that
    // invariant is ever violated, rather than writing a self-referencing row.
    for child in ctx.db.contact().iter() {
        if child.organization_id != organization_id || child.parent_id != Some(source_contact_id) {
            continue;
        }
        if child.id == params.target_contact_id {
            continue;
        }
        ctx.db.contact().id().update(Contact {
            parent_id: Some(params.target_contact_id),
            updated_at: ctx.timestamp,
            ..child
        });
        child_contacts_repointed += 1;
    }

    // Repoint phone identities — dedupe on the exact (kind, company_id, normalized_e164)
    // triple; a repeated distinct number for the same contact is not a duplicate.
    for identity in ctx.db.contact_phone_identity().iter() {
        if identity.organization_id != organization_id || identity.contact_id != source_contact_id {
            continue;
        }
        let duplicate_exists = ctx.db.contact_phone_identity().iter().any(|i| {
            i.organization_id == organization_id
                && i.contact_id == params.target_contact_id
                && i.company_id == identity.company_id
                && i.kind == identity.kind
                && i.normalized_e164 == identity.normalized_e164
        });
        if duplicate_exists {
            ctx.db.contact_phone_identity().id().delete(&identity.id);
        } else {
            let target_already_preferred = identity.is_preferred
                && ctx.db.contact_phone_identity().iter().any(|i| {
                    i.organization_id == organization_id
                        && i.contact_id == params.target_contact_id
                        && i.company_id == identity.company_id
                        && i.kind == identity.kind
                        && i.is_preferred
                        && i.archived_at.is_none()
                });
            ctx.db
                .contact_phone_identity()
                .id()
                .update(ContactPhoneIdentity {
                    contact_id: params.target_contact_id,
                    is_preferred: identity.is_preferred && !target_already_preferred,
                    updated_at: ctx.timestamp,
                    ..identity
                });
        }
        phone_identities_repointed += 1;
    }

    // Repoint contact role assignments — dedupe only active roles that would otherwise
    // duplicate an active role the target already holds; historical (ended) role
    // assignments on the source are preserved and repointed for audit continuity.
    for assignment in ctx.db.contact_role_assignment().iter() {
        if assignment.organization_id != organization_id
            || assignment.contact_id != source_contact_id
        {
            continue;
        }
        let target_has_active_role = assignment.is_active
            && ctx.db.contact_role_assignment().iter().any(|a| {
                a.organization_id == organization_id
                    && a.contact_id == params.target_contact_id
                    && a.company_id == assignment.company_id
                    && a.role == assignment.role
                    && a.is_active
            });
        if target_has_active_role {
            ctx.db.contact_role_assignment().id().delete(&assignment.id);
        } else {
            ctx.db
                .contact_role_assignment()
                .id()
                .update(ContactRoleAssignment {
                    contact_id: params.target_contact_id,
                    ..assignment
                });
        }
        role_assignments_repointed += 1;
    }

    // Repoint CRM conversations — no natural uniqueness constraint per contact, so a
    // straightforward repoint (matching the sale_order/calendar_event pattern) suffices.
    for conversation in ctx.db.crm_conversation().iter() {
        if conversation.organization_id != organization_id
            || conversation.contact_id != source_contact_id
        {
            continue;
        }
        ctx.db.crm_conversation().id().update(CrmConversation {
            contact_id: params.target_contact_id,
            updated_at: ctx.timestamp,
            ..conversation
        });
        conversations_repointed += 1;
    }

    // Repoint relationship insight rows: both the owning contact_id and any embedded
    // related_contact_ids that reference the source. These are recomputed snapshots
    // with no uniqueness constraint, so a plain repoint (plus self-reference cleanup)
    // is sufficient.
    for insight in ctx.db.contact_relationship_insight().iter() {
        if insight.organization_id != organization_id {
            continue;
        }
        let new_owner_id = if insight.contact_id == source_contact_id {
            params.target_contact_id
        } else {
            insight.contact_id
        };
        let mut changed = new_owner_id != insight.contact_id;
        let mut related: Vec<u64> = Vec::with_capacity(insight.related_contact_ids.len());
        for id in &insight.related_contact_ids {
            let repointed = if *id == source_contact_id {
                changed = true;
                params.target_contact_id
            } else {
                *id
            };
            if repointed != new_owner_id && !related.contains(&repointed) {
                related.push(repointed);
            } else if repointed != *id {
                // Dropped because it now duplicates another entry or self-references
                // the owner; the list already changed either way.
            }
        }
        if related.len() != insight.related_contact_ids.len() {
            changed = true;
        }
        if changed {
            ctx.db
                .contact_relationship_insight()
                .id()
                .update(ContactRelationshipInsight {
                    contact_id: new_owner_id,
                    related_contact_ids: related,
                    ..insight
                });
            relationship_insights_repointed += 1;
        }
    }

    // Merge scalar fields into survivor
    let merged = merge_contact_fields(&target, &source);
    ctx.db.contact().id().update(Contact {
        updated_at: ctx.timestamp,
        ..merged
    });

    // Soft-retire source
    ctx.db.contact().id().update(Contact {
        deleted_at: Some(ctx.timestamp),
        merge_target_id: Some(params.target_contact_id),
        updated_at: ctx.timestamp,
        ..source
    });

    // Drop stale duplicate rows involving source
    let stale: Vec<u64> = ctx
        .db
        .contact_duplicate_candidate()
        .iter()
        .filter(|row| {
            row.organization_id == organization_id
                && row.company_id == company_id
                && (row.contact_id_a == source_contact_id
                    || row.contact_id_b == source_contact_id
                    || row.contact_id_a == params.target_contact_id
                    || row.contact_id_b == params.target_contact_id)
        })
        .map(|row| row.id)
        .collect();
    for id in stale {
        ctx.db.contact_duplicate_candidate().id().delete(&id);
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "contact",
            record_id: source_contact_id,
            action: "MERGE",
            old_values: Some(
                serde_json::json!({
                    "source_id": source_contact_id,
                    "source_name": source_name,
                    "target_id": params.target_contact_id,
                    "target_name": target_name,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "merge_target_id": params.target_contact_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["merge_target_id".to_string(), "deleted_at".to_string()],
            metadata: Some(
                serde_json::json!({
                    "repointed": {
                        "opportunities": opportunities_repointed,
                        "leads": leads_repointed,
                        "sale_orders": sale_orders_repointed,
                        "calendar_events": calendar_events_repointed,
                        "segment_members": segment_members_repointed,
                        "tag_assignments": tag_assignments_repointed,
                        "category_assignments": category_assignments_repointed,
                        "relationships": relationships_repointed,
                        "child_contacts": child_contacts_repointed,
                        "phone_identities": phone_identities_repointed,
                        "role_assignments": role_assignments_repointed,
                        "conversations": conversations_repointed,
                        "relationship_insights": relationship_insights_repointed,
                        "segments_recomputed": segments_recomputed,
                    }
                })
                .to_string(),
            ),
        },
    );

    Ok(())
}
