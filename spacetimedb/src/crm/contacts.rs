/// Contacts Module — Contacts, Categories, Tags & Relationships
///
/// Tables:
///   - Contact
///   - ContactCategory
///   - ContactCategoryAssignment
///   - ContactRelationship
///   - ContactTag
///   - ContactTagAssignment
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::country_pack::{
    validate_address_for_packs, validate_company_identifier_for_packs,
};
use crate::core::organization::{company_id_from_scope, require_company_in_organization};
use crate::core::permissions::role;
use crate::core::users::{user_organization, user_profile};
use crate::crm::require_single_company_crm_scope;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = contact,
    index(accessor = contact_by_org, btree(columns = [organization_id])),
    index(accessor = contact_by_company, btree(columns = [company_id])),
    index(accessor = contact_by_email, btree(columns = [email]))
)]
#[derive(Clone)]
pub struct Contact {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub type_: String, // "contact", "company"
    pub name: String,
    pub display_name: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub title: Option<String>,
    pub email: Option<String>,
    pub email_secondary: Option<String>,
    pub phone: Option<String>,
    pub mobile: Option<String>,
    pub fax: Option<String>,
    pub website: Option<String>,
    pub street: Option<String>,
    pub street2: Option<String>,
    pub city: Option<String>,
    pub state_code: Option<String>,
    pub zip: Option<String>,
    pub country_code: Option<String>,
    pub tax_id: Option<String>,
    pub company_registry: Option<String>,
    pub industry: Option<String>,
    pub employees_count: Option<i32>,
    pub annual_revenue: Option<f64>,
    pub description: Option<String>,
    pub is_customer: bool,
    pub is_vendor: bool,
    pub is_employee: bool,
    pub is_prospect: bool,
    pub is_partner: bool,
    pub customer_rank: i32,
    pub supplier_rank: i32,
    pub salesperson_id: Option<Identity>,
    pub assigned_user_id: Option<Identity>,
    pub parent_id: Option<u64>,
    pub user_id: Option<Identity>,
    pub color: Option<String>,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub deleted_at: Option<Timestamp>,
    /// Set when this contact was merged into another; survivor id for traceability.
    pub merge_target_id: Option<u64>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = contact_category,
    index(accessor = category_by_org, btree(columns = [organization_id]))
)]
pub struct ContactCategory {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub color: Option<String>,
    pub parent_id: Option<u64>,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(accessor = contact_category_assignment)]
pub struct ContactCategoryAssignment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub contact_id: u64,
    pub category_id: u64,
    pub assigned_at: Timestamp,
    pub assigned_by: Identity,
    pub metadata: Option<String>,
}

#[spacetimedb::table(accessor = contact_relationship)]
pub struct ContactRelationship {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub left_contact_id: u64,
    pub right_contact_id: u64,
    pub relationship_type: String,
    pub start_date: Option<Timestamp>,
    pub end_date: Option<Timestamp>,
    pub is_active: bool,
    pub notes: Option<String>,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = contact_tag,
    index(accessor = tag_by_org, btree(columns = [organization_id]))
)]
pub struct ContactTag {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub color: Option<String>,
    pub description: Option<String>,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(accessor = contact_tag_assignment)]
pub struct ContactTagAssignment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub contact_id: u64,
    pub tag_id: u64,
    pub assigned_at: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ──────────────────────────────────────────────────────────────

/// `display_name` defaults to `name` if not provided (derived in reducer).
/// `deleted_at` is system-managed; `created_by`/`created_at`/`updated_at` from ctx.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateContactParams {
    pub name: String,
    pub type_: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub mobile: Option<String>,
    pub company_id: Option<u64>,
    pub is_customer: bool,
    pub is_vendor: bool,
    pub is_employee: bool,
    pub is_prospect: bool,
    pub is_partner: bool,
    pub customer_rank: i32,
    pub supplier_rank: i32,
    pub display_name: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub title: Option<String>,
    pub email_secondary: Option<String>,
    pub fax: Option<String>,
    pub website: Option<String>,
    pub street: Option<String>,
    pub street2: Option<String>,
    pub city: Option<String>,
    pub state_code: Option<String>,
    pub zip: Option<String>,
    pub country_code: Option<String>,
    pub tax_id: Option<String>,
    pub company_registry: Option<String>,
    pub industry: Option<String>,
    pub employees_count: Option<i32>,
    pub annual_revenue: Option<f64>,
    pub description: Option<String>,
    pub salesperson_id: Option<Identity>,
    pub assigned_user_id: Option<Identity>,
    pub parent_id: Option<u64>,
    pub user_id: Option<Identity>,
    pub color: Option<String>,
    pub metadata: Option<String>,
}

/// Explicit patch contract (CRM-RI-003): every field uses `Option<Option<T>>`
/// — outer `None` = field not sent (leave unchanged), outer `Some(None)` =
/// explicit clear, outer `Some(Some(v))` = replace with `v`.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateContactAddressParams {
    pub street: Option<Option<String>>,
    pub street2: Option<Option<String>>,
    pub city: Option<Option<String>>,
    pub state_code: Option<Option<String>>,
    pub zip: Option<Option<String>>,
    pub country_code: Option<Option<String>>,
}

/// Explicit patch contract (CRM-RI-003): every field uses `Option<Option<T>>`
/// — outer `None` = field not sent (leave unchanged), outer `Some(None)` =
/// explicit clear, outer `Some(Some(v))` = replace with `v`. This includes
/// `employees_count`/`annual_revenue`, which are genuinely clearable optional
/// facts about a contact (unlike a lead's always-present revenue/probability).
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateContactBusinessParams {
    pub tax_id: Option<Option<String>>,
    pub company_registry: Option<Option<String>>,
    pub industry: Option<Option<String>>,
    pub employees_count: Option<Option<i32>>,
    pub annual_revenue: Option<Option<f64>>,
}

/// Explicit patch contract (CRM-RI-003): every field uses `Option<Option<T>>`
/// — outer `None` = field not sent (leave unchanged), outer `Some(None)` =
/// explicit clear, outer `Some(Some(v))` = replace with `v`.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateContactDetailsParams {
    pub first_name: Option<Option<String>>,
    pub last_name: Option<Option<String>>,
    pub title: Option<Option<String>>,
    pub email_secondary: Option<Option<String>>,
    pub fax: Option<Option<String>>,
    pub website: Option<Option<String>>,
    pub description: Option<Option<String>>,
    pub color: Option<Option<String>>,
}

/// Core contact fields: `None` = keep existing value.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateContactCoreParams {
    pub name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub mobile: Option<String>,
    pub company_id: Option<u64>,
    pub is_customer: Option<bool>,
    pub is_vendor: Option<bool>,
    pub is_prospect: Option<bool>,
    pub is_partner: Option<bool>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateContactTagParams {
    pub name: String,
    pub color: Option<String>,
    pub description: Option<String>,
    pub metadata: Option<String>,
}

/// `end_date`/`is_active` are system-managed (set by `end_contact_relationship`).
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateContactRelationshipParams {
    pub left_contact_id: u64,
    pub right_contact_id: u64,
    pub relationship_type: String,
    pub start_date: Option<Timestamp>,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

// ── Reducers ──────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_contact(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateContactParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact", "create")?;

    if params.name.is_empty() {
        return Err("Contact name cannot be empty".to_string());
    }

    // Derived: display_name defaults to name if not provided
    let display_name = params
        .display_name
        .clone()
        .unwrap_or_else(|| params.name.clone());

    require_single_company_crm_scope(ctx, organization_id, params.company_id)?;
    let operating_company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    validate_company_identifier_for_packs(
        ctx,
        organization_id,
        operating_company_id,
        &params.tax_id,
    )?;
    validate_address_for_packs(
        ctx,
        organization_id,
        operating_company_id,
        &params.country_code,
        &params.city,
        &params.zip,
        &params.state_code,
    )?;

    if let Some(parent_id) = params.parent_id {
        // Contact does not exist yet, so there is no real id to check for
        // self-reference/cycles against — `0` is a safe sentinel since
        // auto-inc ids never assign zero.
        validate_contact_parent(ctx, organization_id, 0, parent_id)?;
    }

    let contact = ctx.db.contact().insert(Contact {
        id: 0,
        organization_id,
        company_id: Some(operating_company_id),
        type_: params.type_,
        name: params.name.clone(),
        display_name,
        first_name: params.first_name,
        last_name: params.last_name,
        title: params.title,
        email: params.email.clone(),
        email_secondary: params.email_secondary,
        phone: params.phone,
        mobile: params.mobile,
        fax: params.fax,
        website: params.website,
        street: params.street,
        street2: params.street2,
        city: params.city,
        state_code: params.state_code,
        zip: params.zip,
        country_code: params.country_code,
        tax_id: params.tax_id,
        company_registry: params.company_registry,
        industry: params.industry,
        employees_count: params.employees_count,
        annual_revenue: params.annual_revenue,
        description: params.description,
        is_customer: params.is_customer,
        is_vendor: params.is_vendor,
        is_employee: params.is_employee,
        is_prospect: params.is_prospect,
        is_partner: params.is_partner,
        customer_rank: params.customer_rank,
        supplier_rank: params.supplier_rank,
        salesperson_id: params.salesperson_id,
        assigned_user_id: params.assigned_user_id,
        parent_id: params.parent_id,
        user_id: params.user_id,
        color: params.color,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        // System-managed: set via delete_contact / merge_contacts
        deleted_at: None,
        merge_target_id: None,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(operating_company_id),
            table_name: "contact",
            record_id: contact.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": params.name, "email": params.email }).to_string(),
            ),
            changed_fields: vec!["name".to_string(), "email".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_contact_address(
    ctx: &ReducerContext,
    organization_id: u64,
    contact_id: u64,
    params: UpdateContactAddressParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact", "write")?;

    let contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;

    if contact.organization_id != organization_id {
        return Err("Contact does not belong to this organization".to_string());
    }

    let street = params.street.unwrap_or_else(|| contact.street.clone());
    let street2 = params.street2.unwrap_or_else(|| contact.street2.clone());
    let city = params.city.unwrap_or_else(|| contact.city.clone());
    let state_code = params
        .state_code
        .unwrap_or_else(|| contact.state_code.clone());
    let zip = params.zip.unwrap_or_else(|| contact.zip.clone());
    let country_code = params
        .country_code
        .unwrap_or_else(|| contact.country_code.clone());

    if let Some(company_id) = contact.company_id {
        validate_address_for_packs(
            ctx,
            organization_id,
            company_id,
            &country_code,
            &city,
            &zip,
            &state_code,
        )?;
    }

    ctx.db.contact().id().update(Contact {
        street,
        street2,
        city,
        state_code,
        zip,
        country_code,
        updated_at: ctx.timestamp,
        ..contact
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "contact",
            record_id: contact_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["street".to_string(), "city".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_contact_business(
    ctx: &ReducerContext,
    organization_id: u64,
    contact_id: u64,
    params: UpdateContactBusinessParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact", "write")?;

    let contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;

    if contact.organization_id != organization_id {
        return Err("Contact does not belong to this organization".to_string());
    }

    let tax_id = params.tax_id.unwrap_or_else(|| contact.tax_id.clone());
    let company_registry = params
        .company_registry
        .unwrap_or_else(|| contact.company_registry.clone());
    let industry = params.industry.unwrap_or_else(|| contact.industry.clone());
    let employees_count = params.employees_count.unwrap_or(contact.employees_count);
    let annual_revenue = params.annual_revenue.unwrap_or(contact.annual_revenue);

    if let Some(company_id) = contact.company_id {
        validate_company_identifier_for_packs(ctx, organization_id, company_id, &tax_id)?;
    }

    ctx.db.contact().id().update(Contact {
        tax_id,
        company_registry,
        industry,
        employees_count,
        annual_revenue,
        updated_at: ctx.timestamp,
        ..contact
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "contact",
            record_id: contact_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["tax_id".to_string(), "industry".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_contact_details(
    ctx: &ReducerContext,
    organization_id: u64,
    contact_id: u64,
    params: UpdateContactDetailsParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact", "write")?;

    let contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;

    if contact.organization_id != organization_id {
        return Err("Contact does not belong to this organization".to_string());
    }

    ctx.db.contact().id().update(Contact {
        first_name: params
            .first_name
            .unwrap_or_else(|| contact.first_name.clone()),
        last_name: params
            .last_name
            .unwrap_or_else(|| contact.last_name.clone()),
        title: params.title.unwrap_or_else(|| contact.title.clone()),
        email_secondary: params
            .email_secondary
            .unwrap_or_else(|| contact.email_secondary.clone()),
        fax: params.fax.unwrap_or_else(|| contact.fax.clone()),
        website: params.website.unwrap_or_else(|| contact.website.clone()),
        description: params
            .description
            .unwrap_or_else(|| contact.description.clone()),
        color: params.color.unwrap_or_else(|| contact.color.clone()),
        updated_at: ctx.timestamp,
        ..contact
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "contact",
            record_id: contact_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![
                "first_name".to_string(),
                "last_name".to_string(),
                "title".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_contact(
    ctx: &ReducerContext,
    organization_id: u64,
    contact_id: u64,
    params: UpdateContactCoreParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact", "write")?;

    let contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;

    if contact.organization_id != organization_id {
        return Err("Contact does not belong to this organization".to_string());
    }

    if let Some(new_company_id) = params.company_id {
        require_company_in_organization(ctx, organization_id, new_company_id)?;
    }

    let old_name = contact.name.clone();
    let old_email = contact.email.clone();

    let new_name = params.name.clone().unwrap_or_else(|| contact.name.clone());
    let new_email = params.email.clone().or(contact.email.clone());

    let mut changed_fields = Vec::new();
    if params.name.is_some() {
        changed_fields.push("name".to_string());
    }
    if params.email.is_some() {
        changed_fields.push("email".to_string());
    }
    if params.phone.is_some() {
        changed_fields.push("phone".to_string());
    }
    if params.mobile.is_some() {
        changed_fields.push("mobile".to_string());
    }
    if params.company_id.is_some() {
        changed_fields.push("company_id".to_string());
    }
    if params.is_customer.is_some() {
        changed_fields.push("is_customer".to_string());
    }
    if params.is_vendor.is_some() {
        changed_fields.push("is_vendor".to_string());
    }
    if params.is_prospect.is_some() {
        changed_fields.push("is_prospect".to_string());
    }
    if params.is_partner.is_some() {
        changed_fields.push("is_partner".to_string());
    }

    let user = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("User not found")?;
    let user_org = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|uo| uo.organization_id == organization_id && uo.is_active)
        .ok_or("User is not a member of this organization")?;
    let role = ctx
        .db
        .role()
        .id()
        .find(user_org.role_id)
        .ok_or("Role not found")?;
    crate::core::permissions::ensure_resource_fields_writable(
        ctx,
        organization_id,
        ctx.sender(),
        role.id,
        &role.name,
        user.is_superuser,
        "contact",
        &changed_fields,
    )?;

    if params.company_id.is_some() {
        require_single_company_crm_scope(ctx, organization_id, params.company_id)?;
    }

    ctx.db.contact().id().update(Contact {
        name: new_name.clone(),
        display_name: new_name,
        email: new_email.clone(),
        phone: params.phone.or(contact.phone.clone()),
        mobile: params.mobile.or(contact.mobile.clone()),
        company_id: params.company_id.or(contact.company_id),
        is_customer: params.is_customer.unwrap_or(contact.is_customer),
        is_vendor: params.is_vendor.unwrap_or(contact.is_vendor),
        is_prospect: params.is_prospect.unwrap_or(contact.is_prospect),
        is_partner: params.is_partner.unwrap_or(contact.is_partner),
        updated_at: ctx.timestamp,
        ..contact
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "contact",
            record_id: contact_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({ "name": old_name, "email": old_email }).to_string(),
            ),
            new_values: Some(
                serde_json::json!({ "name": params.name, "email": new_email }).to_string(),
            ),
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_contact(
    ctx: &ReducerContext,
    organization_id: u64,
    contact_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact", "delete")?;

    let contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;

    if contact.organization_id != organization_id {
        return Err("Contact does not belong to this organization".to_string());
    }

    let contact_name = contact.name.clone();

    ctx.db.contact().id().update(Contact {
        deleted_at: Some(ctx.timestamp),
        updated_at: ctx.timestamp,
        ..contact
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "contact",
            record_id: contact_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": contact_name }).to_string()),
            new_values: None,
            changed_fields: vec!["deleted_at".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_contact_tag(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateContactTagParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact_tag", "create")?;

    if params.name.is_empty() {
        return Err("Tag name cannot be empty".to_string());
    }

    let tag = ctx.db.contact_tag().insert(ContactTag {
        id: 0,
        organization_id,
        name: params.name.clone(),
        color: params.color,
        description: params.description,
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "contact_tag",
            record_id: tag.id,
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
pub fn assign_tag_to_contact(
    ctx: &ReducerContext,
    organization_id: u64,
    contact_id: u64,
    tag_id: u64,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact_tag", "write")?;

    let contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;
    if contact.organization_id != organization_id {
        return Err("Contact does not belong to this organization".to_string());
    }
    let company_id = contact.company_id.ok_or("Contact has no company scope")?;

    let tag = ctx
        .db
        .contact_tag()
        .id()
        .find(&tag_id)
        .ok_or("Tag not found")?;
    if tag.organization_id != organization_id {
        return Err("Tag does not belong to this organization".to_string());
    }

    let already_assigned = ctx.db.contact_tag_assignment().iter().any(|a| {
        a.contact_id == contact_id && a.tag_id == tag_id && a.organization_id == organization_id
    });

    if already_assigned {
        return Err("Tag already assigned to this contact".to_string());
    }

    ctx.db
        .contact_tag_assignment()
        .insert(ContactTagAssignment {
            id: 0,
            organization_id,
            company_id,
            contact_id,
            tag_id,
            assigned_at: ctx.timestamp,
            metadata,
        });

    Ok(())
}

fn require_org_contact(
    ctx: &ReducerContext,
    organization_id: u64,
    contact_id: u64,
) -> Result<Contact, String> {
    let contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;

    if contact.organization_id != organization_id {
        return Err("Contact does not belong to this organization".to_string());
    }

    Ok(contact)
}

/// Validates that `parent_id` is an eligible parent for `contact_id` within
/// `organization_id`: the parent must exist, belong to the same organization,
/// be active (not soft-deleted, not merged away), not be `contact_id` itself,
/// and not be a descendant of `contact_id` (which would create a cycle).
///
/// `contact_id` may be `0` when validating a parent for a contact that does
/// not exist yet (e.g. at creation time, before the auto-inc id is assigned)
/// — real contact ids start above zero, so the self-reference and cycle
/// checks below are simply inert in that case.
fn validate_contact_parent(
    ctx: &ReducerContext,
    organization_id: u64,
    contact_id: u64,
    parent_id: u64,
) -> Result<(), String> {
    if parent_id == contact_id {
        return Err("A contact cannot be its own parent".to_string());
    }

    let parent = ctx
        .db
        .contact()
        .id()
        .find(&parent_id)
        .ok_or("Parent contact not found")?;

    if parent.organization_id != organization_id {
        return Err("Parent contact does not belong to this organization".to_string());
    }

    if parent.deleted_at.is_some() {
        return Err("Parent contact is deleted".to_string());
    }

    if parent.merge_target_id.is_some() {
        return Err("Parent contact has been merged into another contact".to_string());
    }

    // Walk the ancestor chain from the candidate parent; if `contact_id`
    // appears in it, setting this parent would create a cycle. Bounded to
    // avoid looping forever on pre-existing corrupt/cyclic data.
    const MAX_PARENT_CHAIN_DEPTH: usize = 1000;
    let mut current = parent.parent_id;
    for _ in 0..MAX_PARENT_CHAIN_DEPTH {
        match current {
            None => return Ok(()),
            Some(cid) if cid == contact_id => {
                return Err("Setting this parent would create a cycle".to_string());
            }
            Some(cid) => {
                current = ctx.db.contact().id().find(&cid).and_then(|c| c.parent_id);
            }
        }
    }

    Err("Parent chain exceeds maximum depth".to_string())
}

#[spacetimedb::reducer]
pub fn create_contact_relationship(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateContactRelationshipParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact_relationship", "create")?;

    if params.left_contact_id == params.right_contact_id {
        return Err("A contact cannot have a relationship with itself".to_string());
    }

    let left = require_org_contact(ctx, organization_id, params.left_contact_id)?;
    let right = require_org_contact(ctx, organization_id, params.right_contact_id)?;
    let company_id = left.company_id.ok_or("Left contact has no company scope")?;
    if right.company_id != Some(company_id) {
        return Err("Contacts must belong to the same company".to_string());
    }

    let relationship = ctx.db.contact_relationship().insert(ContactRelationship {
        id: 0,
        organization_id,
        company_id,
        left_contact_id: params.left_contact_id,
        right_contact_id: params.right_contact_id,
        relationship_type: params.relationship_type.clone(),
        start_date: params.start_date,
        end_date: None,
        is_active: true,
        notes: params.notes,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "contact_relationship",
            record_id: relationship.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "left_contact_id": params.left_contact_id,
                    "right_contact_id": params.right_contact_id,
                    "relationship_type": params.relationship_type,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "left_contact_id".to_string(),
                "right_contact_id".to_string(),
                "relationship_type".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn end_contact_relationship(
    ctx: &ReducerContext,
    organization_id: u64,
    relationship_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact_relationship", "write")?;

    let relationship = ctx
        .db
        .contact_relationship()
        .id()
        .find(&relationship_id)
        .ok_or("Contact relationship not found")?;

    if relationship.organization_id != organization_id {
        return Err("Relationship does not belong to this organization".to_string());
    }

    if !relationship.is_active {
        return Err("Relationship is already ended".to_string());
    }

    ctx.db
        .contact_relationship()
        .id()
        .update(ContactRelationship {
            is_active: false,
            end_date: Some(ctx.timestamp),
            ..relationship
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "contact_relationship",
            record_id: relationship_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "is_active": true }).to_string()),
            new_values: Some(serde_json::json!({ "is_active": false }).to_string()),
            changed_fields: vec!["is_active".to_string(), "end_date".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Sets or clears `contact_id`'s parent. Delegates to `validate_contact_parent`
/// to reject a missing, cross-organization, inactive/deleted, merged, self,
/// or cycle-forming parent.
#[spacetimedb::reducer]
pub fn update_contact_parent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    contact_id: u64,
    parent_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact", "write")?;

    let target = require_org_contact(ctx, organization_id, contact_id)?;

    if let Some(target_company_id) = target.company_id {
        if target_company_id != company_id {
            return Err("Contact does not belong to this company".to_string());
        }
    }

    if let Some(pid) = parent_id {
        validate_contact_parent(ctx, organization_id, contact_id, pid)?;
    }

    let old_parent_id = target.parent_id;

    ctx.db.contact().id().update(Contact {
        parent_id,
        updated_at: ctx.timestamp,
        ..target
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "contact",
            record_id: contact_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "parent_id": old_parent_id }).to_string()),
            new_values: Some(serde_json::json!({ "parent_id": parent_id }).to_string()),
            changed_fields: vec!["parent_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
