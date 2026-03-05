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

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = contact,
    public,
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
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = contact_category,
    public,
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

#[spacetimedb::table(accessor = contact_category_assignment, public)]
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

#[spacetimedb::table(accessor = contact_relationship, public)]
pub struct ContactRelationship {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
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
    public,
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

#[spacetimedb::table(accessor = contact_tag_assignment, public)]
pub struct ContactTagAssignment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
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

/// Address fields: `None` = clear the field.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateContactAddressParams {
    pub street: Option<String>,
    pub street2: Option<String>,
    pub city: Option<String>,
    pub state_code: Option<String>,
    pub zip: Option<String>,
    pub country_code: Option<String>,
}

/// Business fields: `None` = clear the field.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateContactBusinessParams {
    pub tax_id: Option<String>,
    pub company_registry: Option<String>,
    pub industry: Option<String>,
    pub employees_count: Option<i32>,
    pub annual_revenue: Option<f64>,
}

/// Personal detail fields: `None` = clear the field.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateContactDetailsParams {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub title: Option<String>,
    pub email_secondary: Option<String>,
    pub fax: Option<String>,
    pub website: Option<String>,
    pub description: Option<String>,
    pub color: Option<String>,
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

    let contact = ctx.db.contact().insert(Contact {
        id: 0,
        organization_id,
        company_id: params.company_id,
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
        // System-managed: set via delete_contact
        deleted_at: None,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
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

    ctx.db.contact().id().update(Contact {
        street: params.street,
        street2: params.street2,
        city: params.city,
        state_code: params.state_code,
        zip: params.zip,
        country_code: params.country_code,
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

    ctx.db.contact().id().update(Contact {
        tax_id: params.tax_id,
        company_registry: params.company_registry,
        industry: params.industry,
        employees_count: params.employees_count,
        annual_revenue: params.annual_revenue,
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
        first_name: params.first_name,
        last_name: params.last_name,
        title: params.title,
        email_secondary: params.email_secondary,
        fax: params.fax,
        website: params.website,
        description: params.description,
        color: params.color,
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

    ctx.db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;

    ctx.db
        .contact_tag()
        .id()
        .find(&tag_id)
        .ok_or("Tag not found")?;

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
            contact_id,
            tag_id,
            assigned_at: ctx.timestamp,
            metadata,
        });

    Ok(())
}
