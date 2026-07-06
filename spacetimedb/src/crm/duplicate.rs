/// Contact duplicate detection and merge — complements import wizard duplicate warnings.
use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};

use crate::crm::activities::calendar_event;
use crate::crm::contacts::{
    contact, contact_category_assignment, contact_relationship, contact_tag_assignment, Contact,
};
use crate::crm::leads::lead;
use crate::crm::opportunities::opportunity;
use crate::crm::segments::segment_member;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::sales::sales_core::sale_order;

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = contact_duplicate_candidate,
    public,
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
    value
        .map(|s| s.trim().to_lowercase())
        .unwrap_or_default()
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
        ctx.db.contact_duplicate_candidate().insert(ContactDuplicateCandidate {
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
            new_values: Some(
                serde_json::json!({ "pair_count": pairs.len() }).to_string(),
            ),
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

    let source_name = source.name.clone();
    let target_name = target.name.clone();

    // Repoint opportunities
    for opp in ctx.db.opportunity().iter() {
        if opp.organization_id != organization_id {
            continue;
        }
        let new_partner = repoint_option_id(opp.partner_id, source_contact_id, params.target_contact_id);
        let new_contact = repoint_option_id(opp.contact_id, source_contact_id, params.target_contact_id);
        if new_partner != opp.partner_id || new_contact != opp.contact_id {
            ctx.db.opportunity().id().update(crate::crm::opportunities::Opportunity {
                partner_id: new_partner,
                contact_id: new_contact,
                ..opp
            });
        }
    }

    // Repoint leads
    for lead_row in ctx.db.lead().iter() {
        if lead_row.organization_id != organization_id {
            continue;
        }
        let new_partner = repoint_option_id(lead_row.partner_id, source_contact_id, params.target_contact_id);
        if new_partner != lead_row.partner_id {
            ctx.db.lead().id().update(crate::crm::leads::Lead {
                partner_id: new_partner,
                ..lead_row
            });
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
            ctx.db.sale_order().id().update(crate::sales::sales_core::SaleOrder {
                partner_id,
                partner_invoice_id,
                partner_shipping_id,
                message_partner_ids,
                ..order
            });
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
            ctx.db.calendar_event().id().update(crate::crm::activities::CalendarEvent {
                partner_ids,
                ..event
            });
        }
    }

    // Repoint segment members — skip if target already in segment
    for member in ctx.db.segment_member().iter() {
        if member.organization_id != organization_id || member.contact_id != source_contact_id {
            continue;
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
            ctx.db.segment_member().id().update(crate::crm::segments::SegmentMember {
                contact_id: params.target_contact_id,
                ..member
            });
        }
    }

    // Repoint tag assignments
    for assignment in ctx.db.contact_tag_assignment().iter() {
        if assignment.organization_id != organization_id || assignment.contact_id != source_contact_id {
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
            ctx.db
                .contact_tag_assignment()
                .id()
                .update(crate::crm::contacts::ContactTagAssignment {
                    contact_id: params.target_contact_id,
                    ..assignment
                });
        }
    }

    // Repoint category assignments
    for assignment in ctx.db.contact_category_assignment().iter() {
        if assignment.organization_id != organization_id || assignment.contact_id != source_contact_id {
            continue;
        }
        let target_has = ctx.db.contact_category_assignment().iter().any(|a| {
            a.organization_id == organization_id
                && a.contact_id == params.target_contact_id
                && a.category_id == assignment.category_id
        });
        if target_has {
            ctx.db.contact_category_assignment().id().delete(&assignment.id);
        } else {
            ctx.db
                .contact_category_assignment()
                .id()
                .update(crate::crm::contacts::ContactCategoryAssignment {
                    contact_id: params.target_contact_id,
                    ..assignment
                });
        }
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
                ctx.db.contact_relationship().id().update(crate::crm::contacts::ContactRelationship {
                    left_contact_id: new_left,
                    right_contact_id: new_right,
                    ..rel
                });
            }
        }
    }

    // Repoint child contacts (parent_id)
    for child in ctx.db.contact().iter() {
        if child.organization_id != organization_id || child.parent_id != Some(source_contact_id) {
            continue;
        }
        ctx.db.contact().id().update(Contact {
            parent_id: Some(params.target_contact_id),
            updated_at: ctx.timestamp,
            ..child
        });
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
            changed_fields: vec![
                "merge_target_id".to_string(),
                "deleted_at".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}
