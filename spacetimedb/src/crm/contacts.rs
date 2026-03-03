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

use crate::helpers::{check_permission, write_audit_log};

// ══════════════════════════════════════════════════════════════════════════════
// INPUT TYPES
// ══════════════════════════════════════════════════════════════════════════════

/// Input data for creating a contact
#[derive(SpacetimeType, Clone, Debug)]
pub struct ContactInput {
    pub organization_id: u64,
    pub name: String,
    pub type_: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub mobile: Option<String>,
    pub company_id: Option<u64>,
    pub is_customer: bool,
    pub is_vendor: bool,
    pub is_employee: Option<bool>,
    pub is_prospect: bool,
    pub is_partner: bool,
    pub customer_rank: Option<i32>,
    pub supplier_rank: Option<i32>,
    pub display_name: Option<String>,
    // Personal details
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub title: Option<String>,
    pub email_secondary: Option<String>,
    pub fax: Option<String>,
    pub website: Option<String>,
    // Address fields
    pub street: Option<String>,
    pub street2: Option<String>,
    pub city: Option<String>,
    pub state_code: Option<String>,
    pub zip: Option<String>,
    pub country_code: Option<String>,
    // Business details
    pub tax_id: Option<String>,
    pub company_registry: Option<String>,
    pub industry: Option<String>,
    pub employees_count: Option<i32>,
    pub annual_revenue: Option<f64>,
    pub description: Option<String>,
    // Assignment fields
    pub salesperson_id: Option<Identity>,
    pub assigned_user_id: Option<Identity>,
    pub parent_id: Option<u64>,
    pub user_id: Option<Identity>,
    pub color: Option<String>,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// TABLES: CONTACTS
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = contact,
    public,
    index(accessor = contact_by_org, btree(columns = [organization_id])),
    index(accessor = contact_by_company, btree(columns = [company_id])),
    index(accessor = contact_by_email, btree(columns = [email]))
)]
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

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: CONTACT MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_contact(ctx: &ReducerContext, input: ContactInput) -> Result<(), String> {
    check_permission(ctx, input.organization_id, "contact", "create")?;

    if input.name.is_empty() {
        return Err("Contact name cannot be empty".to_string());
    }

    let display_name = input
        .display_name
        .clone()
        .unwrap_or_else(|| input.name.clone());

    let contact = ctx.db.contact().insert(Contact {
        id: 0,
        organization_id: input.organization_id,
        company_id: input.company_id,
        type_: input.type_,
        name: input.name.clone(),
        display_name,
        first_name: input.first_name,
        last_name: input.last_name,
        title: input.title,
        email: input.email.clone(),
        email_secondary: input.email_secondary,
        phone: input.phone,
        mobile: input.mobile,
        fax: input.fax,
        website: input.website,
        street: input.street,
        street2: input.street2,
        city: input.city,
        state_code: input.state_code,
        zip: input.zip,
        country_code: input.country_code,
        tax_id: input.tax_id,
        company_registry: input.company_registry,
        industry: input.industry,
        employees_count: input.employees_count,
        annual_revenue: input.annual_revenue,
        description: input.description,
        is_customer: input.is_customer,
        is_vendor: input.is_vendor,
        is_employee: input.is_employee.unwrap_or(false),
        is_prospect: input.is_prospect,
        is_partner: input.is_partner,
        customer_rank: input.customer_rank.unwrap_or(0),
        supplier_rank: input.supplier_rank.unwrap_or(0),
        salesperson_id: input.salesperson_id,
        assigned_user_id: input.assigned_user_id,
        parent_id: input.parent_id,
        user_id: input.user_id,
        color: input.color,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        deleted_at: None,
        metadata: input.metadata,
    });

    write_audit_log(
        ctx,
        input.organization_id,
        None,
        "contact",
        contact.id,
        "create",
        None,
        Some(serde_json::json!({ "name": input.name, "email": input.email }).to_string()),
        vec!["name".to_string(), "email".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_contact_address(
    ctx: &ReducerContext,
    contact_id: u64,
    street: Option<String>,
    street2: Option<String>,
    city: Option<String>,
    state_code: Option<String>,
    zip: Option<String>,
    country_code: Option<String>,
) -> Result<(), String> {
    let contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;

    check_permission(ctx, contact.organization_id, "contact", "write")?;

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

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_contact_business(
    ctx: &ReducerContext,
    contact_id: u64,
    tax_id: Option<String>,
    company_registry: Option<String>,
    industry: Option<String>,
    employees_count: Option<i32>,
    annual_revenue: Option<f64>,
) -> Result<(), String> {
    let contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;

    check_permission(ctx, contact.organization_id, "contact", "write")?;

    ctx.db.contact().id().update(Contact {
        tax_id,
        company_registry,
        industry,
        employees_count,
        annual_revenue,
        updated_at: ctx.timestamp,
        ..contact
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_contact_details(
    ctx: &ReducerContext,
    contact_id: u64,
    first_name: Option<String>,
    last_name: Option<String>,
    title: Option<String>,
    email_secondary: Option<String>,
    fax: Option<String>,
    website: Option<String>,
    description: Option<String>,
    color: Option<String>,
) -> Result<(), String> {
    let contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;

    check_permission(ctx, contact.organization_id, "contact", "write")?;

    ctx.db.contact().id().update(Contact {
        first_name,
        last_name,
        title,
        email_secondary,
        fax,
        website,
        description,
        color,
        updated_at: ctx.timestamp,
        ..contact
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_contact(
    ctx: &ReducerContext,
    contact_id: u64,
    name: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    mobile: Option<String>,
    company_id: Option<u64>,
    is_customer: Option<bool>,
    is_vendor: Option<bool>,
    is_prospect: Option<bool>,
    is_partner: Option<bool>,
) -> Result<(), String> {
    let contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;

    check_permission(ctx, contact.organization_id, "contact", "write")?;

    let new_name = name.clone().unwrap_or_else(|| contact.name.clone());
    let new_email = email.clone().or(contact.email.clone());

    ctx.db.contact().id().update(Contact {
        name: new_name.clone(),
        display_name: new_name,
        email: new_email.clone(),
        phone: phone.or(contact.phone.clone()),
        mobile: mobile.or(contact.mobile.clone()),
        company_id: company_id.or(contact.company_id),
        is_customer: is_customer.unwrap_or(contact.is_customer),
        is_vendor: is_vendor.unwrap_or(contact.is_vendor),
        is_prospect: is_prospect.unwrap_or(contact.is_prospect),
        is_partner: is_partner.unwrap_or(contact.is_partner),
        updated_at: ctx.timestamp,
        ..contact
    });

    write_audit_log(
        ctx,
        contact.organization_id,
        None,
        "contact",
        contact_id,
        "update",
        None,
        Some(serde_json::json!({ "name": name, "email": email }).to_string()),
        vec!["name".to_string(), "email".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_contact(ctx: &ReducerContext, contact_id: u64) -> Result<(), String> {
    let contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;

    check_permission(ctx, contact.organization_id, "contact", "delete")?;

    let contact_name = contact.name.clone();

    ctx.db.contact().id().update(Contact {
        deleted_at: Some(ctx.timestamp),
        updated_at: ctx.timestamp,
        ..contact
    });

    write_audit_log(
        ctx,
        contact.organization_id,
        None,
        "contact",
        contact_id,
        "delete",
        Some(serde_json::json!({ "name": contact_name }).to_string()),
        None,
        vec!["deleted_at".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_contact_tag(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    color: Option<String>,
    description: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact_tag", "create")?;

    if name.is_empty() {
        return Err("Tag name cannot be empty".to_string());
    }

    ctx.db.contact_tag().insert(ContactTag {
        id: 0,
        organization_id,
        name,
        color,
        description,
        created_at: ctx.timestamp,
        metadata,
    });

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

    let _contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;

    let _tag = ctx
        .db
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
