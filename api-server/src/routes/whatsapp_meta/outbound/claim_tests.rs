//! Disposable PostgreSQL proof of send claims and early callback correlation.
use super::*;
use crate::cold_tier::pg_pool::{build_pool, PgConfig};
use crate::routes::whatsapp_meta::{
    operator::storage::correlate,
    outbound::{
        policy::{Content, Eligibility, FreshAuthorization},
        send_once, MetaTransport,
    },
    protocol::{event_key, fingerprint, Incoming},
};
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

async fn fixture() -> Result<(Pool, ReviewedMessage)> {
    assert_eq!(std::env::var("WHATSAPP_TEST_PG").as_deref(), Ok("1"));
    let config = PgConfig::from_env()?;
    assert!(matches!(config.host.as_str(), "127.0.0.1" | "localhost"));
    assert!(config.database.ends_with("_whatsapp_test"));
    let pool = build_pool(&config)?;
    store::migrate(&pool).await?;
    let message = ReviewedMessage {
        organization_id: rand::random::<u64>().max(1),
        company_id: 3,
        account_id: 2,
        operational_message_id: 4,
        phone_number_id: "456".into(),
        recipient: "250788123456".into(),
        review_digest: hex::encode(rand::random::<[u8; 32]>()),
        content: Content::Reply("Approved message".into()),
    };
    insert_review(&pool, &message).await?;
    Ok((pool, message))
}

async fn insert_review(pool: &Pool, message: &ReviewedMessage) -> Result<()> {
    pool.get().await?.execute(
        "INSERT INTO lumiere_whatsapp.dispatch_review \
         (id,organization_id,company_id,account_id,conversation_id,conversation_message_id, \
          operational_message_id,actor_identity,source_digest,approved_payload_digest,choice_json,recipient) \
         VALUES ($1,$2,'3','2','5','6',$3,'test-actor',$4,$4,'{\"mode\":\"reply\"}',$5)",
        &[&message.review_digest, &message.organization_id.to_string(),
          &message.operational_message_id.to_string(), &"a".repeat(64), &message.recipient],
    ).await?;
    Ok(())
}

#[tokio::test]
#[ignore = "requires WHATSAPP_TEST_PG=1 and a local *_whatsapp_test database"]
async fn postgres_double_confirmation_unknown_recovery_and_callback_scope() -> Result<()> {
    let (pool, message) = fixture().await?;
    let intent = hex::encode(rand::random::<[u8; 32]>());
    let digest = "a".repeat(64);
    let (left, right) = tokio::join!(
        acquire(&pool, &message, &intent, &digest, 10),
        acquire(&pool, &message, &intent, &digest, 10),
    );
    assert_ne!(left?, right?, "only one confirmation may acquire a send");
    assert!(!acquire(&pool, &message, &intent, &digest, 10).await?);
    assert!(acquire(&pool, &message, &intent, &"b".repeat(64), 10)
        .await
        .is_err());
    pool.get()
        .await?
        .execute(
            "UPDATE lumiere_whatsapp.outbox SET state='unknown' WHERE intent_key=$1",
            &[&intent],
        )
        .await?;
    assert!(!acquire(&pool, &message, &intent, &digest, 10).await?);
    let raw = json!({"id":"wamid.test","status":"delivered","timestamp":"100",
        "recipient_id":message.recipient,"biz_opaque_callback_data":intent});
    let mut event = Incoming {
        organization_id: message.organization_id,
        account_id: 2,
        company_id: Some(3),
        business_account_id: "123".into(),
        phone_number_id: "456".into(),
        kind: "status".into(),
        event_key: event_key("status", &raw),
        fingerprint: fingerprint(&raw),
        payload: raw,
    };
    event.company_id = Some(9);
    assert!(correlate(&pool, &event).await.is_err());
    event.company_id = Some(3);
    event.payload["recipient_id"] = json!("250788123457");
    assert!(correlate(&pool, &event).await.is_err());
    event.payload["recipient_id"] = json!(message.recipient);
    assert_eq!(correlate(&pool, &event).await?, (5, 6, 4));
    assert_eq!(correlate(&pool, &event).await?, (5, 6, 4));
    event.payload["id"] = json!("wamid.other");
    assert!(correlate(&pool, &event).await.is_err());
    assert!(!acquire(&pool, &message, &intent, &digest, 10).await?);
    Ok(())
}

#[tokio::test]
#[ignore = "requires WHATSAPP_TEST_PG=1 and a local *_whatsapp_test database"]
async fn postgres_volume_and_expiry_fail_without_leaving_a_sendable_attempt() -> Result<()> {
    let (pool, mut message) = fixture().await?;
    let digest = "a".repeat(64);
    assert!(acquire(&pool, &message, &"b".repeat(64), &digest, 1).await?);
    message.operational_message_id = 7;
    message.review_digest = hex::encode(rand::random::<[u8; 32]>());
    insert_review(&pool, &message).await?;
    assert!(acquire(&pool, &message, &"c".repeat(64), &digest, 1)
        .await
        .is_err());
    let client = pool.get().await?;
    let count: i64 = client
        .query_one(
            "SELECT count(*) FROM lumiere_whatsapp.outbox WHERE organization_id=$1",
            &[&message.organization_id.to_string()],
        )
        .await?
        .get(0);
    assert_eq!(
        count, 1,
        "rejected rate admission must roll back the prepared row"
    );
    client.execute(
        "UPDATE lumiere_whatsapp.dispatch_review SET expires_at=now()-interval '1 second' WHERE id=$1",
        &[&message.review_digest],
    ).await?;
    drop(client);
    assert!(acquire(&pool, &message, &"c".repeat(64), &digest, 10)
        .await
        .is_err());
    Ok(())
}

struct RevokedAfterClaim(AtomicUsize);

impl FreshAuthorization for RevokedAfterClaim {
    async fn refresh(&self, message: &ReviewedMessage) -> Result<Eligibility> {
        let first = self.0.fetch_add(1, Ordering::SeqCst) == 0;
        Ok(Eligibility {
            organization_id: message.organization_id,
            company_id: message.company_id,
            account_id: message.account_id,
            review_digest: message.review_digest.clone(),
            approved_payload_digest: super::super::policy::reviewed_payload_digest(message)?,
            actor_can_send: first,
            sender_active: true,
            explicit_opt_in: true,
            opted_out: false,
            quiet_hours_allow: true,
            last_customer_message_seconds: Some(chrono::Utc::now().timestamp().max(0) as u64),
            exact_meta_template_approved: false,
            meta_approval_checked_at_seconds: None,
        })
    }
}

#[tokio::test]
#[ignore = "requires WHATSAPP_TEST_PG=1 and a local *_whatsapp_test database"]
async fn postgres_revocation_after_claim_prevents_provider_io() -> Result<()> {
    let (pool, message) = fixture().await?;
    let guard = RevokedAfterClaim(AtomicUsize::new(0));
    let transport = MetaTransport::new("v0.0")?;
    assert!(send_once(
        &pool,
        &transport,
        &message,
        "not-a-live-credential",
        10,
        &guard
    )
    .await
    .is_err());
    assert_eq!(guard.0.load(Ordering::SeqCst), 2);
    let state: String = pool
        .get()
        .await?
        .query_one(
            "SELECT state FROM lumiere_whatsapp.outbox WHERE organization_id=$1",
            &[&message.organization_id.to_string()],
        )
        .await?
        .get(0);
    assert_eq!(state, "rejected");
    Ok(())
}

#[tokio::test]
#[ignore = "requires WHATSAPP_TEST_PG=1 and a local *_whatsapp_test database"]
async fn postgres_late_callbacks_never_extend_the_window_or_clear_stop() -> Result<()> {
    let (pool, message) = fixture().await?;
    let original = chrono::Utc::now().timestamp() - 60;
    let raw = json!({"id":"wamid.window","from":message.recipient,"type":"text",
        "text":{"body":"Hello"},"timestamp":original.to_string()});
    let mut event = Incoming {
        organization_id: message.organization_id,
        account_id: 2,
        company_id: Some(3),
        business_account_id: "123".into(),
        phone_number_id: "456".into(),
        kind: "message".into(),
        event_key: event_key("message", &raw),
        fingerprint: fingerprint(&raw),
        payload: raw,
    };
    store::persist(&pool, &[event.clone()]).await?;
    store::persist(&pool, &[event.clone()]).await?;
    event.payload["id"] = json!("wamid.old-stop");
    event.payload["text"]["body"] = json!("STOP");
    event.payload["timestamp"] = json!((original - 172800).to_string());
    event.event_key = event_key("message", &event.payload);
    event.fingerprint = fingerprint(&event.payload);
    store::persist(&pool, &[event.clone()]).await?;
    // A conflicting provider event is quarantined, not admitted as new facts.
    event.payload["text"]["body"] = json!("Hello again");
    event.payload["timestamp"] = json!(chrono::Utc::now().timestamp().to_string());
    event.fingerprint = fingerprint(&event.payload);
    store::persist(&pool, &[event.clone()]).await?;
    let client = pool.get().await?;
    let row = client.query_one(
        "SELECT last_customer_seconds,stopped_at IS NOT NULL FROM lumiere_whatsapp.recipient_state \
         WHERE organization_id=$1 AND account_id='2' AND recipient=$2",
        &[&message.organization_id.to_string(), &message.recipient],
    ).await?;
    assert_eq!(row.get::<_, i64>(0), original);
    assert!(row.get::<_, bool>(1), "a delayed event must not clear STOP");
    client
        .execute(
            "DELETE FROM lumiere_whatsapp.inbox WHERE organization_id=$1",
            &[&message.organization_id.to_string()],
        )
        .await?;
    client
        .execute(
            "DELETE FROM lumiere_whatsapp.recipient_state WHERE organization_id=$1",
            &[&message.organization_id.to_string()],
        )
        .await?;
    Ok(())
}
