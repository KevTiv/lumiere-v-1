//! Platform credential persistence.

use super::{PlatformId, UserCredential};
use anyhow::{Context, Result};
use deadpool_postgres::Pool;

/// Insert a credential.  Email uniqueness is case-insensitive at the DB
/// boundary, and callers must supply the opaque binding ID explicitly.
pub async fn insert_user_credential(pool: &Pool, credential: &UserCredential) -> Result<()> {
    let client = pool
        .get()
        .await
        .context("get PG client for user credential")?;
    client
        .execute(
            "INSERT INTO lumiere_platform.user_credential \
             (platform_user_id, email, stdb_identity_hex, password_hash, workos_user_id, stdb_token_enc, email_verified) \
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
            &[
                &credential.platform_user_id.as_str(),
                &credential.email,
                &credential.stdb_identity_hex,
                &credential.password_hash,
                &credential.workos_user_id,
                &credential.stdb_token_enc,
                &credential.email_verified,
            ],
        )
        .await
        .context("insert platform user credential")?;
    Ok(())
}

/// Update only the canonical password hash for a platform user.
///
/// Password material never crosses the SpacetimeDB binding boundary.  The
/// affected-row check also prevents silently accepting a reset for a missing
/// platform account.
pub async fn replace_password_hash(
    pool: &Pool,
    platform_user_id: &PlatformId,
    password_hash: &str,
) -> Result<bool> {
    let client = pool
        .get()
        .await
        .context("get PG client to update platform password")?;
    let changed = client
        .execute(
            "UPDATE lumiere_platform.user_credential SET password_hash = $2, updated_at = now() \
             WHERE platform_user_id = $1",
            &[&platform_user_id.as_str(), &password_hash],
        )
        .await
        .context("update platform password hash")?;
    Ok(changed == 1)
}
/// Look up a credential by its opaque platform key.
pub async fn find_user_credential_by_platform_id(
    pool: &Pool,
    platform_user_id: &PlatformId,
) -> Result<Option<tokio_postgres::Row>> {
    let client = pool
        .get()
        .await
        .context("get PG client for credential lookup")?;
    client
        .query_opt(
            "SELECT id, platform_user_id, email, stdb_identity_hex, password_hash, workos_user_id, stdb_token_enc, email_verified \
             FROM lumiere_platform.user_credential WHERE platform_user_id = $1",
            &[&platform_user_id.as_str()],
        )
        .await
        .context("look up platform credential by ID")
}

/// Resolve the platform key from a SpacetimeDB binding.  This is the only
/// supported reverse lookup for an incoming STDB session; ERP code must use
/// the resulting platform ID, never treat the binding as tenant ownership.
pub async fn find_user_credential_by_stdb_identity(
    pool: &Pool,
    stdb_identity_hex: &str,
) -> Result<Option<tokio_postgres::Row>> {
    let client = pool
        .get()
        .await
        .context("get PG client for credential binding lookup")?;
    client
        .query_opt(
            "SELECT id, platform_user_id, email, stdb_identity_hex, password_hash, workos_user_id, stdb_token_enc, email_verified \
             FROM lumiere_platform.user_credential WHERE stdb_identity_hex = $1",
            &[&stdb_identity_hex],
        )
        .await
        .context("look up platform credential by STDB binding")
}
/// Look up a credential by normalized email without interpolating SQL.
pub async fn find_user_credential_by_email(
    pool: &Pool,
    email: &str,
) -> Result<Option<tokio_postgres::Row>> {
    let client = pool
        .get()
        .await
        .context("get PG client for credential lookup")?;
    client
        .query_opt(
            "SELECT id, platform_user_id, email, stdb_identity_hex, password_hash, workos_user_id, stdb_token_enc, email_verified \
             FROM lumiere_platform.user_credential WHERE lower(email) = lower($1)",
            &[&email],
        )
        .await
        .context("look up platform credential by email")
}

/// Look up a credential by its canonical WorkOS subject.
pub async fn find_user_credential_by_workos_user_id(
    pool: &Pool,
    workos_user_id: &str,
) -> Result<Option<tokio_postgres::Row>> {
    let client = pool
        .get()
        .await
        .context("get PG client for WorkOS credential lookup")?;
    client
        .query_opt(
            "SELECT id, platform_user_id, email, stdb_identity_hex, password_hash, workos_user_id, stdb_token_enc, email_verified \
             FROM lumiere_platform.user_credential WHERE workos_user_id = $1",
            &[&workos_user_id],
        )
        .await
        .context("look up platform credential by WorkOS user ID")
}

/// Attach a WorkOS subject to an existing canonical credential.
pub async fn attach_workos_subject(
    pool: &Pool,
    platform_user_id: &PlatformId,
    workos_user_id: &str,
    email_verified: bool,
) -> Result<bool> {
    let client = pool
        .get()
        .await
        .context("get PG client to link WorkOS credential")?;
    let changed = client
        .execute(
            "UPDATE lumiere_platform.user_credential \
             SET workos_user_id = $2, email_verified = $3, updated_at = now() \
             WHERE platform_user_id = $1 \
               AND (workos_user_id IS NULL OR workos_user_id = $2)",
            &[&platform_user_id.as_str(), &workos_user_id, &email_verified],
        )
        .await
        .context("link canonical WorkOS credential")?;
    Ok(changed == 1)
}
