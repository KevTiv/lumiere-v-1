//! Atomic creation of operator-admitted provider identities.
use super::UserCredential;
use anyhow::{Context, Result};
use deadpool_postgres::Pool;

/// Create both control-plane records or neither. Unique subject and email
/// constraints arbitrate concurrent callbacks; no existing identity is linked.
pub async fn insert_workos_identity(
    pool: &Pool,
    credential: &UserCredential,
    first_name: Option<&str>,
    last_name: Option<&str>,
) -> Result<()> {
    let mut client = pool.get().await.context("get provider identity store")?;
    let transaction = client.transaction().await?;
    let inserted = transaction.execute(
        "INSERT INTO lumiere_platform.user_credential (platform_user_id,email,stdb_identity_hex,password_hash,workos_user_id,stdb_token_enc,email_verified) VALUES ($1,$2,$3,NULL,$4,$5,true) ON CONFLICT DO NOTHING",
        &[&credential.platform_user_id.as_str(), &credential.email, &credential.stdb_identity_hex, &credential.workos_user_id, &credential.stdb_token_enc],
    ).await.context("create provider credential")?;
    if inserted == 0 {
        transaction.rollback().await?;
        return Ok(());
    }
    let name = [first_name, last_name]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
    transaction.execute(
        "INSERT INTO lumiere_platform.user_profile (platform_user_id,stdb_identity_hex,email,email_verified,is_active,is_superuser,name,first_name,last_name) VALUES ($1,$2,$3,true,true,false,$4,$5,$6)",
        &[&credential.platform_user_id.as_str(), &credential.stdb_identity_hex, &credential.email, &name, &first_name, &last_name],
    ).await.context("create provider profile")?;
    transaction
        .commit()
        .await
        .context("commit provider identity")
}
