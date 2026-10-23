//! Run only against a dedicated local disposable PostgreSQL database.
use super::*;
use crate::cold_tier::pg_pool::{build_pool, PgConfig};
use serde_json::json;

#[tokio::test]
#[ignore = "requires WHATSAPP_TEST_PG=1 and a local *_whatsapp_test database"]
async fn postgres_replay_conflict_concurrency_and_lease_recovery() -> Result<()> {
    assert_eq!(std::env::var("WHATSAPP_TEST_PG").as_deref(), Ok("1"));
    let config = PgConfig::from_env()?;
    assert!(matches!(config.host.as_str(), "127.0.0.1" | "localhost"));
    assert!(config.database.ends_with("_whatsapp_test"));
    let pool = build_pool(&config)?;
    migrate(&pool).await?;
    verify(&pool).await?;
    let org = rand::random::<u64>().max(1);
    let raw = json!({"id":"wamid.test","from_user_id":"opaque-user",
        "type":"image","image":{"id":"retained-media"}});
    let event = Incoming {
        organization_id: org,
        account_id: 2,
        company_id: Some(3),
        business_account_id: "123".into(),
        phone_number_id: "456".into(),
        kind: "message".into(),
        event_key: super::super::protocol::event_key("message", &raw),
        fingerprint: super::super::protocol::fingerprint(&raw),
        payload: raw,
    };
    persist(&pool, &[event.clone()]).await?;
    persist(&pool, &[event.clone()]).await?;
    let client = pool.get().await?;
    let count: i64 = client.query_one(
        "SELECT count(*) FROM lumiere_whatsapp.inbox WHERE organization_id=$1",
        &[&org.to_string()],
    ).await?.get(0);
    assert_eq!(count, 1, "duplicate webhook must be idempotent");
    let mut changed = event.clone();
    changed.payload["image"]["id"] = json!("different-media");
    changed.fingerprint = super::super::protocol::fingerprint(&changed.payload);
    persist(&pool, &[changed]).await?;
    let conflict: String = client.query_one(
        "SELECT state FROM lumiere_whatsapp.inbox \
         WHERE organization_id=$1 AND fingerprint<>$2",
        &[&org.to_string(), &event.fingerprint],
    ).await?.get(0);
    assert_eq!(conflict, "quarantined");
    drop(client);
    let (first, second) = tokio::join!(claim(&pool), claim(&pool));
    let mut leases: Vec<_> = [first?, second?].into_iter().flatten().collect();
    assert_eq!(leases.len(), 1, "only one worker may claim the event");
    let lease = leases.remove(0);
    assert!(lease.event_json.contains("retained-media"));
    let client = pool.get().await?;
    client.execute(
        "UPDATE lumiere_whatsapp.inbox SET lease_until=now()-interval '1 second' WHERE id=$1",
        &[&lease.id],
    ).await?;
    drop(client);
    let replacement = claim(&pool).await?.expect("expired lease must recover after restart");
    assert_eq!(replacement.id, lease.id);
    assert_ne!(replacement.token, lease.token);
    assert!(finish(&pool, &lease, Outcome::Processed, "stale_worker").await.is_err());
    finish(&pool, &replacement, Outcome::Quarantined, "identity_or_content_triage").await?;
    assert!(requeue(&pool, org + 1, 2, replacement.id).await.is_err());
    requeue(&pool, org, 2, replacement.id).await?;
    let final_lease = claim(&pool).await?.expect("scoped retry must be claimable");
    finish(&pool, &final_lease, Outcome::Processed, "test_processed").await?;
    assert!(requeue(&pool, org, 2, replacement.id).await.is_err());
    Ok(())
}
