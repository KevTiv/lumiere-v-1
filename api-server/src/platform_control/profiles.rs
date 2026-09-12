//! Platform profile persistence.

use super::{PlatformId, UserProfile};
use anyhow::{Context, Result};
use deadpool_postgres::Pool;

/// Look up a profile by its opaque platform key.
pub async fn find_user_profile_by_platform_id(
    pool: &Pool,
    platform_user_id: &PlatformId,
) -> Result<Option<tokio_postgres::Row>> {
    let client = pool
        .get()
        .await
        .context("get PG client for profile lookup")?;
    client
        .query_opt(
            "SELECT platform_user_id, stdb_identity_hex, email, email_verified, name, first_name, last_name, timezone, language, is_active, is_superuser \
             FROM lumiere_platform.user_profile WHERE platform_user_id = $1",
            &[&platform_user_id.as_str()],
        )
        .await
        .context("look up platform profile by ID")
}

/// Resolve a profile from its current SpacetimeDB binding.
pub async fn find_user_profile_by_stdb_identity(
    pool: &Pool,
    stdb_identity_hex: &str,
) -> Result<Option<tokio_postgres::Row>> {
    let client = pool
        .get()
        .await
        .context("get PG client for profile binding lookup")?;
    client
        .query_opt(
            "SELECT platform_user_id, stdb_identity_hex, email, email_verified, name, first_name, last_name, timezone, language, is_active, is_superuser \
             FROM lumiere_platform.user_profile WHERE stdb_identity_hex = $1",
            &[&stdb_identity_hex],
        )
        .await
        .context("look up platform profile by STDB binding")
}

/// Store a profile while preserving the platform ID as its immutable key.
pub async fn upsert_user_profile(pool: &Pool, profile: &UserProfile) -> Result<()> {
    let client = pool.get().await.context("get PG client for user profile")?;
    client
        .execute(
            "INSERT INTO lumiere_platform.user_profile \
             (platform_user_id, stdb_identity_hex, email, email_verified, name, first_name, last_name, timezone, language, is_active, is_superuser) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
             ON CONFLICT (platform_user_id) DO UPDATE SET \
               stdb_identity_hex = EXCLUDED.stdb_identity_hex, email = EXCLUDED.email, \
               email_verified = EXCLUDED.email_verified, name = EXCLUDED.name, \
               first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, \
               timezone = EXCLUDED.timezone, language = EXCLUDED.language, \
               is_active = EXCLUDED.is_active, updated_at = now()",
            &[
                &profile.platform_user_id.as_str(),
                &profile.stdb_identity_hex,
                &profile.email,
                &profile.email_verified,
                &profile.name,
                &profile.first_name,
                &profile.last_name,
                &profile.timezone,
                &profile.language,
                &profile.is_active,
                &profile.is_superuser,
            ],
        )
        .await
        .context("upsert platform user profile")?;
    Ok(())
}

/// Update mutable profile fields in platform-control storage. `None` means
/// keep the existing value; organization membership is intentionally absent.
pub async fn update_user_profile(
    pool: &Pool,
    platform_user_id: &PlatformId,
    name: Option<&str>,
    first_name: Option<&str>,
    last_name: Option<&str>,
    timezone: Option<&str>,
    language: Option<&str>,
) -> Result<bool> {
    let client = pool
        .get()
        .await
        .context("get PG client to update user profile")?;
    let changed = client
        .execute(
            "UPDATE lumiere_platform.user_profile SET \
               name = COALESCE($2, name), first_name = COALESCE($3, first_name), \
               last_name = COALESCE($4, last_name), timezone = COALESCE($5, timezone), \
               language = COALESCE($6, language), updated_at = now() \
             WHERE platform_user_id = $1",
            &[
                &platform_user_id.as_str(),
                &name,
                &first_name,
                &last_name,
                &timezone,
                &language,
            ],
        )
        .await
        .context("update platform user profile")?;
    Ok(changed == 1)
}

/// Update the canonical account email in one transaction. Email changes are
/// deliberately platform-scoped because both credentials and profile rows
/// carry the display value. Verification is cleared whenever the address is
/// changed; a separate provider callback must establish verification.
pub async fn update_user_email(
    pool: &Pool,
    platform_user_id: &PlatformId,
    email: &str,
) -> Result<bool> {
    let mut client = pool
        .get()
        .await
        .context("get PG client to update user email")?;
    let transaction = client
        .transaction()
        .await
        .context("begin user email transaction")?;
    let credential_changed = transaction
        .execute(
            "UPDATE lumiere_platform.user_credential SET email = $2, email_verified = false, updated_at = now() \
             WHERE platform_user_id = $1",
            &[&platform_user_id.as_str(), &email],
        )
        .await
        .context("update platform credential email")?;
    let profile_changed = transaction
        .execute(
            "UPDATE lumiere_platform.user_profile SET email = $2, email_verified = false, updated_at = now() \
             WHERE platform_user_id = $1",
            &[&platform_user_id.as_str(), &email],
        )
        .await
        .context("update platform profile email")?;
    if credential_changed != 1 || profile_changed != 1 {
        transaction
            .rollback()
            .await
            .context("rollback incomplete user email update")?;
        return Ok(false);
    }
    transaction
        .commit()
        .await
        .context("commit user email transaction")?;
    Ok(true)
}
