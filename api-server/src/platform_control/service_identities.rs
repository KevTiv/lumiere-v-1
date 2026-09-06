//! Trusted cold-tier service identity persistence.

use super::ColdTierServiceIdentity;
use anyhow::{Context, Result};
use deadpool_postgres::Pool;

/// Register one active service binding and retire the previous binding for the
/// same service atomically.  This is intentionally a platform operation and
/// takes an opaque registrar ID rather than an organization ID.
pub async fn register_cold_tier_service_identity(
    pool: &Pool,
    identity: &ColdTierServiceIdentity,
) -> Result<i64> {
    let mut client = pool
        .get()
        .await
        .context("get PG client for service identity")?;
    let transaction = client
        .transaction()
        .await
        .context("begin service identity transaction")?;
    transaction
        .execute(
            "UPDATE lumiere_platform.cold_tier_service_identity \
             SET is_active = false, retired_at = now() \
             WHERE service_name = $1 AND is_active",
            &[&identity.service_name],
        )
        .await
        .context("retire prior platform service identity")?;
    let row = transaction
        .query_one(
            "INSERT INTO lumiere_platform.cold_tier_service_identity \
             (service_name, platform_id, stdb_identity_hex, registered_by) \
             VALUES ($1, $2, $3, $4) RETURNING id",
            &[
                &identity.service_name,
                &identity.platform_id.as_str(),
                &identity.stdb_identity_hex,
                &identity.registered_by.as_str(),
            ],
        )
        .await
        .context("insert platform service identity")?;
    transaction
        .commit()
        .await
        .context("commit service identity transaction")?;
    Ok(row.get("id"))
}
/// Find the currently-active binding for a cold-tier service.
pub async fn active_cold_tier_service_identity(
    pool: &Pool,
    service_name: &str,
) -> Result<Option<tokio_postgres::Row>> {
    let client = pool
        .get()
        .await
        .context("get PG client for active service identity")?;
    client
        .query_opt(
            "SELECT id, service_name, platform_id, stdb_identity_hex, registered_by, registered_at \
             FROM lumiere_platform.cold_tier_service_identity \
             WHERE service_name = $1 AND is_active",
            &[&service_name],
        )
        .await
        .context("look up active platform service identity")
}
