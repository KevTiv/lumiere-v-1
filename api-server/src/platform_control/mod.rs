//! Platform-control storage for global identity and schema state.
//!
//! These rows are deliberately outside the generated ERP schema.  They are
//! global application control-plane state, not organization data, and must
//! therefore not be projected into an organization shard.  SpacetimeDB may
//! keep an organization-owned binding, but the canonical profile, credential,
//! reset-token, service-identity, and migration records live here.
//!
//! `platform_user_id` is the stable opaque key shared with those bindings.
//! `stdb_identity_hex` is only a revocable binding to a SpacetimeDB identity;
//! it is never used as the ownership key for an ERP row.

use anyhow::Result;
use rand::RngCore;
use std::fmt;
use std::time::SystemTime;

mod credentials;
mod password_resets;
mod profiles;
mod schema;
mod service_identities;

pub use credentials::{
    attach_workos_subject, find_user_credential_by_email, find_user_credential_by_platform_id,
    find_user_credential_by_stdb_identity, find_user_credential_by_workos_user_id,
    insert_user_credential, replace_password_hash,
};
pub use password_resets::{
    consume_password_reset_token, find_password_reset_token, insert_password_reset_token,
};
pub use profiles::{
    find_user_profile_by_platform_id, find_user_profile_by_stdb_identity, update_user_email,
    update_user_profile, upsert_user_profile,
};
pub use schema::{
    ensure_schema, PLATFORM_CONTROL_DDL, PLATFORM_RESET_TOKEN_BINDING_DDL, PLATFORM_SCHEMA,
    PLATFORM_SCHEMA_BOOTSTRAP_DDL, SCHEMA_MIGRATION_TABLE,
};
pub use service_identities::{
    active_cold_tier_service_identity, register_cold_tier_service_identity,
};

/// Opaque platform identity shared with organization-owned bindings.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct PlatformId(String);

impl PlatformId {
    /// Construct a platform ID from a trusted value.
    pub fn new(value: impl Into<String>) -> Result<Self> {
        let value = value.into();
        if value.is_empty() || value.len() > 128 || value.bytes().any(|byte| byte == 0) {
            anyhow::bail!("platform id must be 1..=128 bytes and contain no NUL")
        }
        Ok(Self(value))
    }

    /// Generate a fresh, non-semantic platform ID.
    pub fn generate() -> Self {
        let mut bytes = [0_u8; 24];
        rand::thread_rng().fill_bytes(&mut bytes);
        Self(format!("p_{}", hex::encode(bytes)))
    }

    /// Borrow the ID for query parameters or binding payloads.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for PlatformId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl TryFrom<String> for PlatformId {
    type Error = anyhow::Error;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

/// A platform credential with no organization-owned fields.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UserCredential {
    pub platform_user_id: PlatformId,
    pub email: String,
    pub stdb_identity_hex: String,
    pub password_hash: Option<String>,
    pub workos_user_id: Option<String>,
    pub stdb_token_enc: String,
    pub email_verified: bool,
}

/// A platform profile shared across organization memberships.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UserProfile {
    pub platform_user_id: PlatformId,
    pub stdb_identity_hex: String,
    pub email: String,
    pub email_verified: bool,
    pub name: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub timezone: String,
    pub language: String,
    pub is_active: bool,
    pub is_superuser: bool,
}

/// A registered service binding used by trusted cold-tier workers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ColdTierServiceIdentity {
    pub service_name: String,
    pub platform_id: PlatformId,
    pub stdb_identity_hex: String,
    pub registered_by: PlatformId,
}

/// A reset token lookup result.  Plaintext tokens are never persisted.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PasswordResetToken {
    pub platform_reset_token_id: PlatformId,
    pub platform_user_id: PlatformId,
    pub token_hash: String,
    pub expires_at: SystemTime,
    pub used_at: Option<SystemTime>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_ids_are_opaque_and_bounded() {
        let id = PlatformId::new("tenant-user-opaque").expect("valid platform id");
        assert_eq!(id.as_str(), "tenant-user-opaque");
        assert!(PlatformId::new("").is_err());
        assert!(PlatformId::new("bad\0id").is_err());
        assert!(PlatformId::new("x".repeat(129)).is_err());
    }

    #[test]
    fn generated_id_is_not_an_stdb_or_org_identifier() {
        let id = PlatformId::generate();
        assert!(id.as_str().starts_with("p_"));
        assert_eq!(id.as_str().len(), 50);
    }

    #[test]
    fn ddl_is_outside_the_erp_manifest_and_has_global_guards() {
        assert!(PLATFORM_CONTROL_DDL.contains("CREATE SCHEMA IF NOT EXISTS lumiere_platform"));
        assert!(PLATFORM_SCHEMA_BOOTSTRAP_DDL.contains("schema_migration"));
        for table in [
            "schema_migration",
            "cold_tier_service_identity",
            "user_credential",
            "user_profile",
            "password_reset_token",
        ] {
            assert!(PLATFORM_CONTROL_DDL.contains(&format!("lumiere_platform.{table}")));
        }
        assert!(PLATFORM_CONTROL_DDL.contains("lower(email)"));
        assert!(PLATFORM_CONTROL_DDL.contains("REFERENCES lumiere_platform.user_profile"));
        assert!(PLATFORM_CONTROL_DDL.contains("platform_reset_token_id TEXT NOT NULL UNIQUE"));
        assert!(PLATFORM_RESET_TOKEN_BINDING_DDL.contains("ADD COLUMN IF NOT EXISTS"));
        // PostgreSQL does not permit the volatile current time in a partial-index
        // predicate. Expiry is enforced by the atomic consume query; the index
        // only narrows the lookup to unused tokens.
        assert!(PLATFORM_CONTROL_DDL.contains("WHERE used_at IS NULL"));
        assert!(!PLATFORM_CONTROL_DDL.contains("organization_id"));
    }
}
