//! Atomic creation of operator-admitted provider identities.
use super::UserCredential;
use anyhow::{Context, Result};
use deadpool_postgres::Pool;

/// Create both control-plane records or neither. Unique subject and email
/// constraints arbitrate concurrent callbacks; no existing identity is linked.
pub async fn insert_workos_identity(pool: &Pool, credential: &UserCredential) -> Result<()> {
    let mut client = pool.get().await.context("get provider identity store")?;
    let transaction = client.transaction().await?;
    transaction.execute(
        "INSERT INTO lumiere_platform.user_credential (platform_user_id,email,stdb_identity_hex,password_hash,workos_user_id,stdb_token_enc,email_verified) VALUES ($1,$2,$3,NULL,$4,$5,true)",
        &[&credential.platform_user_id.as_str(), &credential.email, &credential.stdb_identity_hex, &credential.workos_user_id, &credential.stdb_token_enc],
    ).await.context("create provider credential")?;
    transaction.execute(
        "INSERT INTO lumiere_platform.user_profile (platform_user_id,stdb_identity_hex,email,email_verified,is_active,is_superuser) VALUES ($1,$2,$3,true,true,false)",
        &[&credential.platform_user_id.as_str(), &credential.stdb_identity_hex, &credential.email],
    ).await.context("create provider profile")?;
    transaction
        .commit()
        .await
        .context("commit provider identity")
}
