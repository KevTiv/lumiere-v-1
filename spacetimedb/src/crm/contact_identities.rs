/// Contact phone identities — normalized, verified, masked phone numbers.
///
/// `Contact` remains the party master. This module stores phone/WhatsApp/mobile-money
/// identities as child records. The legacy `phone` and `mobile` columns on `Contact` are
/// kept as read-compatible projections until all consumers migrate.
use sha2::{Digest, Sha256};
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::require_company_in_organization;
use crate::core::users::find_user_profile_for_organization;
use crate::crm::contacts::{contact, Contact};
use crate::crm::require_single_company_crm_scope;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{ContactIdentityKind, ContactVerificationState};

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = contact_phone_identity,
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

/// Immutable evidence recorded by a trusted provider adapter after it has
/// independently verified possession of the identity value. This table is
/// private: browser clients must never receive evidence hashes or provider
/// references.
#[spacetimedb::table(
    accessor = contact_identity_verification_proof,
    index(accessor = contact_identity_proof_by_org, btree(columns = [organization_id])),
    index(accessor = contact_identity_proof_by_identity, btree(columns = [identity_id]))
)]
#[derive(Clone)]
pub struct ContactIdentityVerificationProof {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub contact_id: u64,
    pub identity_id: u64,
    pub normalized_e164: String,
    /// Verification mechanism, currently `otp` or `provider_attestation`.
    pub method: String,
    pub provider: String,
    /// Provider idempotency key. Unique within an organization.
    pub provider_reference: String,
    /// SHA-256 digest of the provider evidence. Raw OTPs are never persisted.
    pub evidence_hash: String,
    pub issued_at: Timestamp,
    pub expires_at: Timestamp,
    pub recorded_by: Identity,
    pub recorded_at: Timestamp,
}

/// Organization-scoped trust anchor for the server/provider adapter identity.
/// This is an exact SpacetimeDB principal, not an organization role or CRM
/// permission.
#[spacetimedb::table(
    accessor = contact_identity_verification_authority,
    index(accessor = verification_authority_by_organization, btree(columns = [organization_id]))
)]
#[derive(Clone)]
pub struct ContactIdentityVerificationAuthority {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    #[unique]
    pub organization_authority_key: String,
    pub issuer_identity: Identity,
    pub configured_by: Identity,
    pub configured_at: Timestamp,
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
    /// Legacy compatibility field. Callers must leave server-owned state unset.
    pub verification_state: Option<ContactVerificationState>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateContactIdentityParams {
    pub company_id: Option<u64>,
    pub raw_value: Option<String>,
    pub is_preferred: Option<bool>,
    /// Legacy compatibility field. Callers must leave server-owned state unset.
    pub verification_state: Option<ContactVerificationState>,
    pub metadata: Option<String>,
}

/// Proof supplied by a trusted provider adapter. Scope fields are deliberately
/// repeated and validated against current rows so a valid proof cannot be
/// replayed for another identity or after the phone number changes.
#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordContactIdentityVerificationProofParams {
    pub identity_id: u64,
    pub contact_id: u64,
    pub company_id: Option<u64>,
    pub normalized_e164: String,
    pub method: String,
    pub provider: String,
    pub provider_reference: String,
    pub evidence_hash: String,
    pub issued_at_micros: i64,
    pub expires_at_micros: i64,
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
        return Err("phone number cannot be empty".to_string());
    }

    let country = default_region.and_then(|r| phonenumber::country::Id::from_str(r).ok());

    let phone = phonenumber::parse(country, trimmed)
        .map_err(|e| format!("invalid phone number '{}': {:?}", raw, e))?;

    if !phonenumber::is_valid(&phone) {
        return Err(format!("phone number '{}' is not a valid number", raw));
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
        .ok_or("contact not found")?;

    if contact.organization_id != organization_id {
        return Err("contact does not belong to this organization".to_string());
    }

    if contact.deleted_at.is_some() {
        return Err("contact is deleted".to_string());
    }

    Ok(contact)
}

fn validate_contact_company_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    contact: &Contact,
    identity_company_id: Option<u64>,
) -> Result<(), String> {
    if contact.company_id != identity_company_id {
        return Err("contact identity company must match the contact company".to_string());
    }

    if let Some(cid) = contact.company_id {
        require_company_in_organization(ctx, organization_id, cid)?;
    }

    require_single_company_crm_scope(ctx, organization_id, contact.company_id)?;
    Ok(())
}

fn validate_requested_company_scope(
    contact: &Contact,
    requested_company_id: Option<u64>,
) -> Result<(), String> {
    if let Some(company_id) = requested_company_id {
        if contact.company_id != Some(company_id) {
            return Err("contact identity company must match the contact company".to_string());
        }
    }
    Ok(())
}

fn reject_caller_verification_state(
    verification_state: Option<&ContactVerificationState>,
) -> Result<(), String> {
    if verification_state.is_some() {
        return Err("verification state is server-owned".to_string());
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
            .ok_or("preferred identity disappeared during update")?;
        ctx.db
            .contact_phone_identity()
            .id()
            .update(ContactPhoneIdentity {
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
            "cannot change verification state of an opted-out identity; create a new one instead"
                .to_string(),
        ),
        _ => Ok(()),
    }
}

const MAX_VERIFICATION_PROOF_LIFETIME_MICROS: i64 = 15 * 60 * 1_000_000;

fn require_trusted_verification_issuer(
    ctx: &ReducerContext,
    organization_id: u64,
) -> Result<(), String> {
    let authority = ctx
        .db
        .contact_identity_verification_authority()
        .iter()
        .find(|authority| authority.organization_id == organization_id)
        .ok_or("contact identity verification authority is not configured")?;
    if authority.issuer_identity != ctx.sender() {
        return Err("trusted verification issuer authority required".to_string());
    }
    let caller = find_user_profile_for_organization(ctx, ctx.sender(), organization_id)
        .ok_or("trusted verification issuer profile not found")?;
    if !caller.is_active || !caller.is_superuser {
        return Err("trusted verification issuer authority required".to_string());
    }
    Ok(())
}

fn constant_time_str_eq(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.as_bytes()
        .iter()
        .zip(right.as_bytes())
        .fold(0_u8, |difference, (left, right)| {
            difference | (*left ^ *right)
        })
        == 0
}

fn validate_proof_text(label: &str, value: &str, max_len: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("verification proof {label} cannot be empty"));
    }
    if value.len() > max_len {
        return Err(format!("verification proof {label} is too long"));
    }
    Ok(value.to_string())
}

fn validate_evidence_hash(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase();
    let Some(hex) = normalized.strip_prefix("sha256:") else {
        return Err("verification evidence hash must use the sha256: prefix".to_string());
    };
    if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(
            "verification evidence hash must contain 64 hexadecimal characters".to_string(),
        );
    }
    Ok(normalized)
}

/// Canonical helper for trusted adapters and tests. The digest binds provider
/// evidence to the exact current identity scope; raw OTP/provider payloads are
/// not retained by the module.
pub fn contact_identity_evidence_hash(
    organization_id: u64,
    company_id: Option<u64>,
    contact_id: u64,
    identity_id: u64,
    normalized_e164: &str,
    provider_evidence: &str,
) -> String {
    let company = company_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| "shared".to_string());
    let canonical = format!(
        "crm-contact-identity-proof-v1\n{organization_id}\n{company}\n{contact_id}\n{identity_id}\n{normalized_e164}\n{provider_evidence}"
    );
    format!("sha256:{:x}", Sha256::digest(canonical.as_bytes()))
}

fn proof_matches_request(
    proof: &ContactIdentityVerificationProof,
    params: &RecordContactIdentityVerificationProofParams,
    method: &str,
    provider: &str,
    provider_reference: &str,
    evidence_hash: &str,
) -> bool {
    proof.company_id == params.company_id
        && proof.contact_id == params.contact_id
        && proof.identity_id == params.identity_id
        && proof.normalized_e164 == params.normalized_e164
        && proof.method == method
        && proof.provider == provider
        && proof.provider_reference == provider_reference
        && constant_time_str_eq(&proof.evidence_hash, evidence_hash)
        && proof.issued_at.to_micros_since_unix_epoch() == params.issued_at_micros
        && proof.expires_at.to_micros_since_unix_epoch() == params.expires_at_micros
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
    validate_requested_company_scope(&contact, params.company_id)?;
    validate_contact_company_scope(ctx, organization_id, &contact, contact.company_id)?;
    reject_caller_verification_state(params.verification_state.as_ref())?;

    let default_region = default_region_for_contact(&contact);
    let normalized = normalize_phone(&params.raw_value, default_region.as_deref())?;
    let display_masked = mask_e164(&normalized);

    let identity = ctx
        .db
        .contact_phone_identity()
        .insert(ContactPhoneIdentity {
            id: 0,
            organization_id,
            company_id: contact.company_id,
            contact_id: params.contact_id,
            kind: params.kind.clone(),
            normalized_e164: normalized.clone(),
            display_masked,
            verification_state: ContactVerificationState::Unverified,
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
            company_id: contact.company_id,
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
    reject_caller_verification_state(params.verification_state.as_ref())?;

    let identity = ctx
        .db
        .contact_phone_identity()
        .id()
        .find(&identity_id)
        .ok_or("contact identity not found")?;

    if identity.organization_id != organization_id {
        return Err("identity does not belong to this organization".to_string());
    }

    if identity.archived_at.is_some() {
        return Err("archived identity cannot be updated".to_string());
    }

    let contact = load_active_contact(ctx, organization_id, identity.contact_id)?;
    validate_contact_company_scope(ctx, organization_id, &contact, identity.company_id)?;
    validate_requested_company_scope(&contact, params.company_id)?;

    let raw_value_provided = params.raw_value.is_some();
    let (normalized, display_masked) = match params.raw_value.as_ref() {
        Some(raw) => {
            if identity.verification_state == ContactVerificationState::OptedOut {
                return Err(
                    "cannot change the phone number of an opted-out identity; create a new one instead"
                        .to_string(),
                );
            }
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

    let verification_state = if raw_value_provided {
        ContactVerificationState::Unverified
    } else {
        identity.verification_state.clone()
    };
    let verified_at = if verification_state == ContactVerificationState::Verified {
        identity.verified_at
    } else {
        None
    };

    let is_preferred = params.is_preferred.unwrap_or(identity.is_preferred);

    let mut changed_fields = Vec::new();
    if raw_value_provided {
        changed_fields.push("normalized_e164".to_string());
        changed_fields.push("verification_state".to_string());
        changed_fields.push("verified_at".to_string());
    }
    if params.is_preferred.is_some() {
        changed_fields.push("is_preferred".to_string());
    }

    let updated = ContactPhoneIdentity {
        company_id: contact.company_id,
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
    requested_state: ContactVerificationState,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact_identity", "verify")?;
    let _ = (identity_id, requested_state);
    Err(
        "permission-only identity verification is disabled; a trusted OTP/provider proof is required"
            .to_string(),
    )
}

/// Configure or rotate the exact server/provider adapter principal. Initial
/// configuration requires the global server superuser; subsequent rotation
/// additionally requires the currently configured principal, preventing an
/// unrelated administrator from replacing the trust anchor.
#[spacetimedb::reducer]
pub fn configure_contact_identity_verification_authority(
    ctx: &ReducerContext,
    organization_id: u64,
    issuer_identity: Identity,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact_identity_verification_authority", "write")?;
    let caller = find_user_profile_for_organization(ctx, ctx.sender(), organization_id)
        .ok_or("verification authority configurator profile not found")?;
    if !caller.is_active || !caller.is_superuser {
        return Err("global server superuser authority required".to_string());
    }

    if let Some(existing) = ctx
        .db
        .contact_identity_verification_authority()
        .iter()
        .find(|authority| authority.organization_id == organization_id)
    {
        if existing.issuer_identity != ctx.sender() {
            return Err(
                "only the current verification authority may rotate the issuer".to_string(),
            );
        }
        ctx.db
            .contact_identity_verification_authority()
            .id()
            .update(ContactIdentityVerificationAuthority {
                issuer_identity,
                configured_by: ctx.sender(),
                configured_at: ctx.timestamp,
                ..existing
            });
    } else {
        ctx.db.contact_identity_verification_authority().insert(
            ContactIdentityVerificationAuthority {
                id: 0,
                organization_id,
                organization_authority_key: format!("{organization_id}:verification"),
                issuer_identity,
                configured_by: ctx.sender(),
                configured_at: ctx.timestamp,
            },
        );
    }
    Ok(())
}

/// Record proof from a trusted OTP/provider adapter and atomically mark the
/// scoped identity verified. The adapter authenticates the provider callback,
/// hashes its evidence outside the database, and invokes this reducer using the
/// server/superuser principal. Ordinary CRM writers cannot issue proof rows.
#[spacetimedb::reducer]
pub fn record_contact_identity_verification_proof(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RecordContactIdentityVerificationProofParams,
) -> Result<(), String> {
    require_trusted_verification_issuer(ctx, organization_id)?;

    let identity = ctx
        .db
        .contact_phone_identity()
        .id()
        .find(&params.identity_id)
        .ok_or("contact identity not found")?;
    if identity.organization_id != organization_id {
        return Err("identity does not belong to this organization".to_string());
    }
    if identity.archived_at.is_some() {
        return Err("archived identity cannot be verified".to_string());
    }

    let contact = load_active_contact(ctx, organization_id, identity.contact_id)?;
    validate_contact_company_scope(ctx, organization_id, &contact, identity.company_id)?;
    verify_state_transition(
        &identity.verification_state,
        &ContactVerificationState::Verified,
    )?;

    if params.contact_id != identity.contact_id
        || params.company_id != identity.company_id
        || params.normalized_e164 != identity.normalized_e164
    {
        return Err("verification proof scope does not match the current identity".to_string());
    }

    let method = validate_proof_text("method", &params.method, 32)?.to_ascii_lowercase();
    if method != "otp" && method != "provider_attestation" {
        return Err("verification proof method must be otp or provider_attestation".to_string());
    }
    let provider = validate_proof_text("provider", &params.provider, 100)?;
    let provider_reference =
        validate_proof_text("provider reference", &params.provider_reference, 255)?;
    let evidence_hash = validate_evidence_hash(&params.evidence_hash)?;

    let existing = ctx
        .db
        .contact_identity_verification_proof()
        .contact_identity_proof_by_org()
        .filter(&organization_id)
        .find(|proof| proof.provider_reference == provider_reference);
    if let Some(proof) = existing {
        if proof_matches_request(
            &proof,
            &params,
            &method,
            &provider,
            &provider_reference,
            &evidence_hash,
        ) && identity.verification_state == ContactVerificationState::Verified
        {
            return Ok(());
        }
        return Err(
            "provider verification reference was already used with different evidence".to_string(),
        );
    }
    if identity.verification_state == ContactVerificationState::Verified {
        return Err(
            "identity is already verified; only an exact provider retry is accepted".to_string(),
        );
    }

    let now_micros = ctx.timestamp.to_micros_since_unix_epoch();
    if params.issued_at_micros > now_micros {
        return Err("verification proof cannot be issued in the future".to_string());
    }
    if params.expires_at_micros <= now_micros {
        return Err("verification proof has expired".to_string());
    }
    let lifetime = params
        .expires_at_micros
        .checked_sub(params.issued_at_micros)
        .ok_or("verification proof lifetime is invalid")?;
    if lifetime <= 0 || lifetime > MAX_VERIFICATION_PROOF_LIFETIME_MICROS {
        return Err(
            "verification proof lifetime must be between zero and fifteen minutes".to_string(),
        );
    }

    let proof =
        ctx.db
            .contact_identity_verification_proof()
            .insert(ContactIdentityVerificationProof {
                id: 0,
                organization_id,
                company_id: identity.company_id,
                contact_id: identity.contact_id,
                identity_id: identity.id,
                normalized_e164: identity.normalized_e164.clone(),
                method: method.clone(),
                provider: provider.clone(),
                provider_reference,
                evidence_hash,
                issued_at: Timestamp::from_micros_since_unix_epoch(params.issued_at_micros),
                expires_at: Timestamp::from_micros_since_unix_epoch(params.expires_at_micros),
                recorded_by: ctx.sender(),
                recorded_at: ctx.timestamp,
            });

    ctx.db
        .contact_phone_identity()
        .id()
        .update(ContactPhoneIdentity {
            verification_state: ContactVerificationState::Verified,
            verified_at: Some(ctx.timestamp),
            updated_at: ctx.timestamp,
            ..identity.clone()
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: identity.company_id,
            table_name: "contact_phone_identity",
            record_id: identity.id,
            action: "VERIFY",
            old_values: Some(
                serde_json::json!({
                    "verification_state": identity.verification_state.as_str(),
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "verification_state": ContactVerificationState::Verified.as_str(),
                    "verification_proof_id": proof.id,
                    "verification_method": method,
                    "verification_provider": provider,
                })
                .to_string(),
            ),
            changed_fields: vec!["verification_state".to_string(), "verified_at".to_string()],
            metadata: Some(
                serde_json::json!({
                    "proof_table": "contact_identity_verification_proof",
                    "proof_id": proof.id,
                })
                .to_string(),
            ),
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
        .ok_or("contact identity not found")?;

    if identity.organization_id != organization_id {
        return Err("identity does not belong to this organization".to_string());
    }

    if identity.archived_at.is_some() {
        return Err("identity is already archived".to_string());
    }

    let contact = load_active_contact(ctx, organization_id, identity.contact_id)?;
    validate_contact_company_scope(ctx, organization_id, &contact, identity.company_id)?;

    ctx.db
        .contact_phone_identity()
        .id()
        .update(ContactPhoneIdentity {
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

    #[test]
    fn caller_selected_verification_state_is_rejected() {
        assert!(reject_caller_verification_state(None).is_ok());
        assert!(
            reject_caller_verification_state(Some(&ContactVerificationState::Unverified)).is_err()
        );
        assert!(
            reject_caller_verification_state(Some(&ContactVerificationState::Verified)).is_err()
        );
    }

    #[test]
    fn opted_out_identity_cannot_be_verified() {
        assert!(verify_state_transition(
            &ContactVerificationState::OptedOut,
            &ContactVerificationState::Verified,
        )
        .is_err());
        assert!(verify_state_transition(
            &ContactVerificationState::Unverified,
            &ContactVerificationState::Verified,
        )
        .is_ok());
    }
}
