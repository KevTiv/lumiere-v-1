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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform_control::{self, PlatformId};
    use sha2::{Digest, Sha256};

    fn credential(id: PlatformId, subject: &str, email: &str) -> UserCredential {
        UserCredential {
            stdb_identity_hex: hex::encode(Sha256::digest(id.as_str().as_bytes())),
            platform_user_id: id,
            email: email.into(),
            password_hash: None,
            workos_user_id: Some(subject.into()),
            stdb_token_enc: "local-test-ciphertext".into(),
            email_verified: true,
        }
    }

    #[tokio::test]
    #[ignore = "requires an isolated PostgreSQL database in WORKOS_TEST_DATABASE_URL"]
    async fn postgres_identity_and_profile_lifecycle_is_atomic() -> Result<()> {
        let url = std::env::var("WORKOS_TEST_DATABASE_URL")?;
        let mut config = deadpool_postgres::Config::new();
        config.url = Some(url);
        let pool = config.create_pool(
            Some(deadpool_postgres::Runtime::Tokio1),
            tokio_postgres::NoTls,
        )?;
        let client = pool.get().await?;
        client
            .batch_execute(platform_control::PLATFORM_CONTROL_DDL)
            .await?;
        client
            .batch_execute(platform_control::PLATFORM_IDENTITY_LIFECYCLE_DDL)
            .await?;
        let nonce = PlatformId::generate();
        let subject = format!("workos_{}", nonce.as_str());
        let email = format!("{}@example.test", nonce.as_str());
        let first = credential(PlatformId::generate(), &subject, &email);
        let second = credential(PlatformId::generate(), &subject, &email);
        let (a, b) = tokio::join!(
            insert_workos_identity(&pool, &first, Some("Initial"), Some("Name")),
            insert_workos_identity(&pool, &second, Some("Initial"), Some("Name")),
        );
        a?;
        b?;
        let winner = platform_control::find_user_credential_by_workos_user_id(&pool, &subject)
            .await?
            .expect("one callback wins");
        let id = PlatformId::new(winner.get::<_, String>("platform_user_id"))?;
        let count: i64 = client
            .query_one(
                "SELECT count(*) FROM lumiere_platform.user_profile WHERE platform_user_id=$1",
                &[&id.as_str()],
            )
            .await?
            .get(0);
        assert_eq!(count, 1);
        insert_workos_identity(&pool, &first, Some("Retry must not overwrite"), None).await?;
        let profile = platform_control::find_user_profile_by_platform_id(&pool, &id)
            .await?
            .unwrap();
        assert_eq!(profile.get::<_, String>("name"), "Initial Name");

        assert!(
            platform_control::save_profile_patch(
                &pool,
                &id,
                &[7, 8],
                None,
                Some("Edited"),
                None,
                None,
                Some("UTC"),
                None
            )
            .await?
        );
        assert!(
            platform_control::save_profile_patch(
                &pool,
                &id,
                &[7],
                None,
                Some("Edited twice"),
                None,
                None,
                None,
                None
            )
            .await?
        );
        let pending = client.query("SELECT organization_id,revision FROM lumiere_platform.profile_projection_pending WHERE platform_user_id=$1 ORDER BY organization_id", &[&id.as_str()]).await?;
        assert_eq!(
            pending
                .iter()
                .map(|r| (r.get::<_, i64>(0), r.get::<_, i64>(1)))
                .collect::<Vec<_>>(),
            vec![(7, 2), (8, 1)]
        );
        assert!(
            !platform_control::sync_workos_email(
                &pool,
                &id,
                "wrong-subject",
                "wrong@example.test",
                &[7]
            )
            .await?
        );
        let changed_email = format!("changed-{}@example.test", nonce.as_str());
        assert!(
            platform_control::sync_workos_email(&pool, &id, &subject, &changed_email, &[7, 8])
                .await?
        );
        let profile = platform_control::find_user_profile_by_platform_id(&pool, &id)
            .await?
            .unwrap();
        assert_eq!(profile.get::<_, String>("email"), changed_email);
        assert_eq!(profile.get::<_, String>("name"), "Edited twice");
        let credential = platform_control::find_user_credential_by_platform_id(&pool, &id)
            .await?
            .unwrap();
        assert_eq!(credential.get::<_, String>("email"), changed_email);

        let native_id = PlatformId::generate();
        let native_email = format!("native-{}@example.test", nonce.as_str());
        let native_identity = hex::encode(Sha256::digest(native_id.as_str().as_bytes()));
        client.execute("INSERT INTO lumiere_platform.user_credential (platform_user_id,email,stdb_identity_hex,stdb_token_enc) VALUES ($1,$2,$3,'test')", &[&native_id.as_str(),&native_email,&native_identity]).await?;
        client.execute("INSERT INTO lumiere_platform.user_profile (platform_user_id,email,stdb_identity_hex) VALUES ($1,$2,$3)", &[&native_id.as_str(),&native_email,&native_identity]).await?;
        let linked_subject = format!("linked_{}", nonce.as_str());
        assert!(
            platform_control::attach_workos_subject(&pool, &native_id, &linked_subject, true)
                .await?
        );
        assert!(
            platform_control::attach_workos_subject(&pool, &native_id, &linked_subject, true)
                .await?
        );
        assert!(
            !platform_control::attach_workos_subject(
                &pool,
                &native_id,
                "another-provider-subject",
                true
            )
            .await?
        );
        let count: i64 = client.query_one("SELECT count(*) FROM lumiere_platform.identity_link_audit WHERE platform_user_id=$1", &[&native_id.as_str()]).await?.get(0);
        assert_eq!(count, 1);
        // A failing email change rolls back the earlier profile update and outbox revision.
        assert!(platform_control::save_profile_patch(
            &pool,
            &native_id,
            &[7],
            Some(&changed_email),
            Some("Must roll back"),
            None,
            None,
            None,
            None
        )
        .await
        .is_err());
        let native_profile = platform_control::find_user_profile_by_platform_id(&pool, &native_id)
            .await?
            .unwrap();
        assert_eq!(native_profile.get::<_, String>("name"), "");
        let count: i64 = client.query_one("SELECT count(*) FROM lumiere_platform.profile_projection_pending WHERE platform_user_id=$1", &[&native_id.as_str()]).await?.get(0);
        assert_eq!(count, 0);
        client.execute("UPDATE lumiere_platform.user_profile SET is_active=false WHERE platform_user_id=$1", &[&native_id.as_str()]).await?;
        assert!(
            !platform_control::attach_workos_subject(&pool, &native_id, &linked_subject, false)
                .await?
        );
        let native_credential =
            platform_control::find_user_credential_by_platform_id(&pool, &native_id)
                .await?
                .unwrap();
        assert!(native_credential.get::<_, bool>("email_verified"));
        Ok(())
    }
}
