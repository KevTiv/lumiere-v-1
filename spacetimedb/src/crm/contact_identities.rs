/// Contact phone identities — normalized, verified, masked phone numbers.
///
/// `Contact` remains the party master. This module stores phone/WhatsApp/mobile-money
/// identities as child records. The legacy `phone` and `mobile` columns on `Contact` are
/// kept as read-compatible projections until all consumers migrate.
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::require_company_in_organization;
use crate::crm::contacts::{contact, Contact};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{ContactIdentityKind, ContactVerificationState};

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = contact_phone_identity,
    public,
    index(accessor = contact_phone_identity_by_org, btree(columns = [organization_id])),
    index(accessor = contact_phone_identity_by_contact, btree(columns = [contact_id])),
    index(accessor = contact_phone_identity_by_lookup, btree(columns = [organization_id, normalized_e164]))
)]
#[derive(Clone)]
pub struct ContactPhoneIdentity {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    /// Company scope. `None` means organization-level identity.
    pub company_id: Option<u64>,
    pub contact_id: u64,
    pub kind: ContactIdentityKind,
    /// Plain E.164 normalized value. Restricted by default in the query registry.
    pub normalized_e164: String,
    /// Masked value for default display.
    pub display_masked: String,
    pub verification_state: ContactVerificationState,
    pub is_preferred: bool,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub verified_at: Option<Timestamp>,
    /// Soft archive. Archived identities are not deleted; they remain auditable.
    pub archived_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateContactIdentityParams {
    pub contact_id: u64,
    pub company_id: Option<u64>,
    pub kind: ContactIdentityKind,
    /// Raw phone number as entered by the user. Normalized to E.164 by the reducer.
    pub raw_value: String,
    pub is_preferred: bool,
    pub verification_state: Option<ContactVerificationState>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateContactIdentityParams {
    pub company_id: Option<u64>,
    pub raw_value: Option<String>,
    pub is_preferred: Option<bool>,
    pub verification_state: Option<ContactVerificationState>,
    pub metadata: Option<String>,
}

// ── Phone normalization helpers ───────────────────────────────────────────────

/// Normalize a raw phone number to E.164.
///
/// Uses the `phonenumber` crate. The default region is derived from the contact's
/// `country_code` when present; otherwise the input must already include a country code.
/// Returns an error if the number cannot be parsed or is not a possible number.
pub fn normalize_phone(raw: &str, default_region: Option<&str>) -> Result<String, String> {
    use std::str::FromStr;

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Phone number cannot be empty".to_string());
    }

    let country = default_region
        .and_then(|r| phonenumber::country::Id::from_str(r).ok());

    let phone = phonenumber::parse(country, trimmed)
        .map_err(|e| format!("Invalid phone number '{}': {:?}", raw, e))?;

    if !phonenumber::is_valid(&phone) {
        return Err(format!("Phone number '{}' is not a valid number", raw));
    }

    Ok(phonenumber::format(&phone).to_string())
}

/// Build a masked display string from a normalized E.164 number.
///
/// Shows the leading `+` plus country code and the final 3 digits, masking the
/// middle. Short numbers are fully masked.
///
/// Example: `+1555010100` -> `+155****100`
pub fn mask_e164(normalized: &str) -> String {
    let chars: Vec<char> = normalized.chars().collect();
    let len = chars.len();
    if len <= 7 {
        return "*".repeat(len);
    }

    let prefix_len = 4;
    let suffix_len = 3;
    let masked_len = len.saturating_sub(prefix_len + suffix_len);

    let mut out = String::with_capacity(len);
    out.extend(chars.iter().take(prefix_len));
    out.extend(std::iter::repeat('*').take(masked_len));
    out.extend(chars.iter().skip(len - suffix_len));
    out
}

// ── Scope validation helpers ──────────────────────────────────────────────────

fn load_active_contact(
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

    if contact.deleted_at.is_some() {
        return Err("Contact is deleted".to_string());
    }

    Ok(contact)
}

fn validate_company_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
) -> Result<(), String> {
    if let Some(cid) = company_id {
        require_company_in_organization(ctx, organization_id, cid)?;
    }
    Ok(())
}

fn default_region_for_contact(contact: &Contact) -> Option<String> {
    contact
        .country_code
        .as_ref()
        .map(|c| c.to_uppercase())
        .filter(|c| !c.is_empty())
}

fn identity_scope_matches(a: &ContactPhoneIdentity, b: &ContactPhoneIdentity) -> bool {
    a.contact_id == b.contact_id && a.kind == b.kind && a.company_id == b.company_id
}

fn ensure_unique_preferred(
    ctx: &ReducerContext,
    identity: &ContactPhoneIdentity,
) -> Result<(), String> {
    if !identity.is_preferred {
        return Ok(());
    }

    let existing: Vec<u64> = ctx
        .db
        .contact_phone_identity()
        .contact_phone_identity_by_contact()
        .filter(&identity.contact_id)
        .filter(|i| {
            i.id != identity.id
                && identity_scope_matches(i, identity)
                && i.is_preferred
                && i.archived_at.is_none()
        })
        .map(|i| i.id)
        .collect();

    for id in existing {
        let other = ctx
            .db
            .contact_phone_identity()
            .id()
            .find(&id)
            .ok_or("Preferred identity disappeared during update")?;
        ctx.db.contact_phone_identity().id().update(ContactPhoneIdentity {
            is_preferred: false,
            updated_at: ctx.timestamp,
            ..other
        });
    }

    Ok(())
}

fn verify_state_transition(
    current: &ContactVerificationState,
    next: &ContactVerificationState,
) -> Result<(), String> {
    match (current, next) {
        (ContactVerificationState::OptedOut, _) => Err(
            "Cannot change verification state of an opted-out identity; create a new one instead"
                .to_string(),
        ),
        _ => Ok(()),
    }
}

// ── Reducers ──────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_contact_identity(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateContactIdentityParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact_identity", "create")?;

    let contact = load_active_contact(ctx, organization_id, params.contact_id)?;
    validate_company_scope(ctx, organization_id, params.company_id)?;

    let default_region = default_region_for_contact(&contact);
    let normalized = normalize_phone(&params.raw_value, default_region.as_deref())?;
    let display_masked = mask_e164(&normalized);
    let verification_state = params
        .verification_state
        .unwrap_or(ContactVerificationState::Unverified);

    let identity = ctx.db.contact_phone_identity().insert(ContactPhoneIdentity {
        id: 0,
        organization_id,
        company_id: params.company_id,
        contact_id: params.contact_id,
        kind: params.kind.clone(),
        normalized_e164: normalized.clone(),
        display_masked,
        verification_state,
        is_preferred: params.is_preferred,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        verified_at: None,
        archived_at: None,
        metadata: params.metadata,
    });

    ensure_unique_preferred(ctx, &identity)?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "contact_phone_identity",
            record_id: identity.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "contact_id": params.contact_id,
                    "kind": params.kind.as_str(),
                    "normalized_e164": normalized,
                    "is_preferred": params.is_preferred,
                    "verification_state": identity.verification_state.as_str(),
                })
                .to_string(),
            ),
            changed_fields: vec![
                "contact_id".to_string(),
                "kind".to_string(),
                "normalized_e164".to_string(),
                "is_preferred".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_contact_identity(
    ctx: &ReducerContext,
    organization_id: u64,
    identity_id: u64,
    params: UpdateContactIdentityParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact_identity", "write")?;

    let identity = ctx
        .db
        .contact_phone_identity()
        .id()
        .find(&identity_id)
        .ok_or("Contact identity not found")?;

    if identity.organization_id != organization_id {
        return Err("Identity does not belong to this organization".to_string());
    }

    if identity.archived_at.is_some() {
        return Err("Archived identity cannot be updated".to_string());
    }

    if let Some(cid) = params.company_id {
        if identity.company_id != Some(cid) {
            validate_company_scope(ctx, organization_id, Some(cid))?;
        }
    }

    let raw_value_provided = params.raw_value.is_some();
    let (normalized, display_masked) = match params.raw_value.as_ref() {
        Some(raw) => {
            let contact = load_active_contact(ctx, organization_id, identity.contact_id)?;
            let default_region = default_region_for_contact(&contact);
            let n = normalize_phone(raw, default_region.as_deref())?;
            let m = mask_e164(&n);
            (n, m)
        }
        None => (
            identity.normalized_e164.clone(),
            identity.display_masked.clone(),
        ),
    };

    let verification_state_provided = params.verification_state.is_some();
    let verification_state = params
        .verification_state
        .as_ref()
        .unwrap_or(&identity.verification_state)
        .clone();
    verify_state_transition(&identity.verification_state, &verification_state)?;

    let verified_at = if verification_state == ContactVerificationState::Verified
        && identity.verification_state != ContactVerificationState::Verified
    {
        Some(ctx.timestamp)
    } else {
        identity.verified_at
    };

    let is_preferred = params.is_preferred.unwrap_or(identity.is_preferred);

    let mut changed_fields = Vec::new();
    if params.company_id.is_some() {
        changed_fields.push("company_id".to_string());
    }
    if raw_value_provided {
        changed_fields.push("normalized_e164".to_string());
    }
    if verification_state_provided {
        changed_fields.push("verification_state".to_string());
    }
    if params.is_preferred.is_some() {
        changed_fields.push("is_preferred".to_string());
    }

    let updated = ContactPhoneIdentity {
        company_id: params.company_id.or(identity.company_id),
        normalized_e164: normalized.clone(),
        display_masked,
        verification_state,
        is_preferred,
        updated_at: ctx.timestamp,
        verified_at,
        metadata: params.metadata.or_else(|| identity.metadata.clone()),
        ..identity.clone()
    };

    ctx.db.contact_phone_identity().id().update(updated.clone());
    ensure_unique_preferred(ctx, &updated)?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: updated.company_id,
            table_name: "contact_phone_identity",
            record_id: identity_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({
                    "normalized_e164": identity.normalized_e164,
                    "verification_state": identity.verification_state.as_str(),
                    "is_preferred": identity.is_preferred,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "normalized_e164": normalized,
                    "verification_state": updated.verification_state.as_str(),
                    "is_preferred": updated.is_preferred,
                })
                .to_string(),
            ),
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn verify_contact_identity(
    ctx: &ReducerContext,
    organization_id: u64,
    identity_id: u64,
    state: ContactVerificationState,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact_identity", "verify")?;

    let identity = ctx
        .db
        .contact_phone_identity()
        .id()
        .find(&identity_id)
        .ok_or("Contact identity not found")?;

    if identity.organization_id != organization_id {
        return Err("Identity does not belong to this organization".to_string());
    }

    if identity.archived_at.is_some() {
        return Err("Archived identity cannot be verified".to_string());
    }

    verify_state_transition(&identity.verification_state, &state)?;

    let verified_at = if state == ContactVerificationState::Verified
        && identity.verification_state != ContactVerificationState::Verified
    {
        Some(ctx.timestamp)
    } else {
        identity.verified_at
    };

    ctx.db.contact_phone_identity().id().update(ContactPhoneIdentity {
        verification_state: state.clone(),
        verified_at,
        updated_at: ctx.timestamp,
        ..identity.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: identity.company_id,
            table_name: "contact_phone_identity",
            record_id: identity_id,
            action: "VERIFY",
            old_values: Some(
                serde_json::json!({
                    "verification_state": identity.verification_state.as_str(),
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "verification_state": state.as_str(),
                })
                .to_string(),
            ),
            changed_fields: vec!["verification_state".to_string(), "verified_at".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn archive_contact_identity(
    ctx: &ReducerContext,
    organization_id: u64,
    identity_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact_identity", "delete")?;

    let identity = ctx
        .db
        .contact_phone_identity()
        .id()
        .find(&identity_id)
        .ok_or("Contact identity not found")?;

    if identity.organization_id != organization_id {
        return Err("Identity does not belong to this organization".to_string());
    }

    if identity.archived_at.is_some() {
        return Err("Identity is already archived".to_string());
    }

    ctx.db.contact_phone_identity().id().update(ContactPhoneIdentity {
        archived_at: Some(ctx.timestamp),
        is_preferred: false,
        updated_at: ctx.timestamp,
        ..identity.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: identity.company_id,
            table_name: "contact_phone_identity",
            record_id: identity_id,
            action: "ARCHIVE",
            old_values: Some(serde_json::json!({ "archived_at": null }).to_string()),
            new_values: Some(
                serde_json::json!({ "archived_at": ctx.timestamp.to_string() }).to_string(),
            ),
            changed_fields: vec!["archived_at".to_string(), "is_preferred".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ── Read helpers used by duplicate detection / messaging ──────────────────────

/// Find active phone identities for a contact, optionally filtered by kind.
pub fn active_identities_for_contact(
    ctx: &ReducerContext,
    contact_id: u64,
    kind: Option<&ContactIdentityKind>,
) -> Vec<ContactPhoneIdentity> {
    ctx.db
        .contact_phone_identity()
        .contact_phone_identity_by_contact()
        .filter(&contact_id)
        .filter(|i| i.archived_at.is_none())
        .filter(|i| kind.map(|k| i.kind == *k).unwrap_or(true))
        .collect()
}

/// Find an active identity by normalized E.164 within an organization.
pub fn find_identity_by_normalized(
    ctx: &ReducerContext,
    organization_id: u64,
    normalized: &str,
) -> Option<ContactPhoneIdentity> {
    ctx.db
        .contact_phone_identity()
        .contact_phone_identity_by_lookup()
        .filter(&organization_id)
        .find(|i| i.normalized_e164 == normalized && i.archived_at.is_none())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_us_test_numbers() {
        assert_eq!(
            normalize_phone("+1 415 555 2671", None).unwrap(),
            "+14155552671"
        );
        assert_eq!(
            normalize_phone("(415) 555-2671", Some("US")).unwrap(),
            "+14155552671"
        );
    }

    #[test]
    fn mask_e164_obscures_middle_digits() {
        assert_eq!(mask_e164("+14155552671"), "+141*****671");
        assert_eq!(mask_e164("+12345678901"), "+123*****901");
    }
}
