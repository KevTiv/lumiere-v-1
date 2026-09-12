//! Password reset-token persistence.

use super::PlatformId;
use anyhow::{Context, Result};
use deadpool_postgres::Pool;
use std::time::SystemTime;

/// Insert a hashed reset token for one platform user.
pub async fn insert_password_reset_token(
    pool: &Pool,
    platform_user_id: &PlatformId,
    token_hash: &str,
    expires_at: SystemTime,
) -> Result<PlatformId> {
    let platform_reset_token_id = PlatformId::generate();
    let client = pool.get().await.context("get PG client for reset token")?;
    let row = client
        .query_one(
            "INSERT INTO lumiere_platform.password_reset_token \
            (platform_reset_token_id, platform_user_id, token_hash, expires_at) \
             VALUES ($1, $2, $3, $4) RETURNING platform_reset_token_id",
            &[
                &platform_reset_token_id.as_str(),
                &platform_user_id.as_str(),
                &token_hash,
                &expires_at,
            ],
        )
        .await
        .context("insert platform password reset token")?;
    PlatformId::new(row.get::<_, String>("platform_reset_token_id"))
}

/// Find a reset token by hash.  The plaintext token is never accepted by this
/// boundary, and used/expired state remains visible only to the server.
pub async fn find_password_reset_token(
    pool: &Pool,
    token_hash: &str,
) -> Result<Option<tokio_postgres::Row>> {
    let client = pool
        .get()
        .await
        .context("get PG client for reset token lookup")?;
    client
        .query_opt(
            "SELECT platform_reset_token_id, platform_user_id, token_hash, expires_at, used_at \
             FROM lumiere_platform.password_reset_token WHERE token_hash = $1",
            &[&token_hash],
        )
        .await
        .context("look up platform password reset token")
}

/// Atomically consume a reset token.  A zero-row update means missing, used,
/// or expired and callers must not distinguish those cases to clients.
pub async fn consume_password_reset_token(pool: &Pool, token_hash: &str) -> Result<bool> {
    let client = pool
        .get()
        .await
        .context("get PG client to consume reset token")?;
    let changed = client
        .execute(
            "UPDATE lumiere_platform.password_reset_token SET used_at = now() \
             WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()",
            &[&token_hash],
        )
        .await
        .context("consume platform password reset token")?;
    Ok(changed == 1)
}
