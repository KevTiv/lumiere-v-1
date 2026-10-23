//! Immutable reviewed dispatch and scoped transport readback, never an ERP ledger.
use anyhow::{bail, Result};
use deadpool_postgres::Pool;
use serde_json::{json, Value};

use super::source::{Choice, Source};
use crate::routes::whatsapp_meta::{outbound::policy, protocol::Incoming, store};

pub(super) struct Review {
    pub id: String,
    pub actor: String,
    pub company_id: u64,
    pub message_id: u64,
    pub source_digest: String,
    pub approved_payload_digest: String,
    pub choice: Choice,
}

pub(super) async fn save(pool: &Pool, source: &mut Source, choice: &Choice) -> Result<Review> {
    store::verify(pool).await?;
    let id = hex::encode(rand::random::<[u8; 32]>());
    source.message.review_digest = id.clone();
    source.eligibility.review_digest = id.clone();
    let approved = policy::reviewed_payload_digest(&source.message)?;
    source.eligibility.approved_payload_digest = approved.clone();
    policy::validate(&source.message, &source.eligibility, super::now_seconds())?;
    let org = source.message.organization_id.to_string();
    let company = source.message.company_id.to_string();
    let operational = source.message.operational_message_id.to_string();
    let client = pool.get().await?;
    if client.query_opt(
        "SELECT 1 FROM lumiere_whatsapp.outbox WHERE organization_id=$1 AND operational_message_id=$2",
        &[&org, &operational],
    ).await?.is_some() {
        bail!("this message already has a dispatch attempt; check its status instead of resending");
    }
    client.execute(
        "INSERT INTO lumiere_whatsapp.dispatch_review \
         (id,organization_id,company_id,account_id,conversation_id,conversation_message_id, \
          operational_message_id,actor_identity,source_digest,approved_payload_digest,choice_json,recipient) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        &[&id, &org, &company, &source.message.account_id.to_string(),
          &source.conversation_id.to_string(), &source.message_id.to_string(), &operational,
          &source.actor, &source.digest, &approved, &serde_json::to_string(choice)?, &source.message.recipient],
    ).await?;
    Ok(Review {
        id,
        actor: source.actor.clone(),
        company_id: source.message.company_id,
        message_id: source.message_id,
        source_digest: source.digest.clone(),
        approved_payload_digest: approved,
        choice: choice.clone(),
    })
}

pub(super) async fn review(
    pool: &Pool,
    org: u64,
    company: u64,
    message: u64,
    actor: &str,
    id: &str,
) -> Result<Review> {
    if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!("invalid WhatsApp review identifier");
    }
    let client = pool.get().await?;
    let row = client.query_opt(
        "SELECT source_digest,approved_payload_digest,choice_json FROM lumiere_whatsapp.dispatch_review \
         WHERE id=$1 AND organization_id=$2 AND company_id=$3 AND conversation_message_id=$4 \
         AND actor_identity=$5 AND expires_at>now()",
        &[&id, &org.to_string(), &company.to_string(), &message.to_string(), &actor],
    ).await?.ok_or_else(|| anyhow::anyhow!("review expired or belongs to another actor or scope"))?;
    Ok(Review {
        id: id.to_owned(),
        actor: actor.to_owned(),
        company_id: company,
        message_id: message,
        source_digest: row.get(0),
        approved_payload_digest: row.get(1),
        choice: serde_json::from_str(&row.get::<_, String>(2))?,
    })
}

pub(super) fn check_source(review: &Review, source: &mut Source) -> Result<()> {
    if review.actor != source.actor
        || review.company_id != source.message.company_id
        || review.message_id != source.message_id
        || review.source_digest != source.digest
        || policy::reviewed_payload_digest(&source.message)? != review.approved_payload_digest
    {
        bail!("sender, recipient, source or template changed; review the message again");
    }
    source.message.review_digest = review.id.clone();
    source.eligibility.review_digest = review.id.clone();
    source.eligibility.approved_payload_digest = review.approved_payload_digest.clone();
    policy::validate(&source.message, &source.eligibility, super::now_seconds())
}

pub(super) async fn state(pool: &Pool, org: u64, company: u64, operational: u64) -> Result<Value> {
    let client = pool.get().await?;
    let row = client
        .query_opt(
            "SELECT state,provider_message_id IS NOT NULL FROM lumiere_whatsapp.outbox \
         WHERE organization_id=$1 AND company_id=$2 AND operational_message_id=$3",
            &[
                &org.to_string(),
                &company.to_string(),
                &operational.to_string(),
            ],
        )
        .await?;
    Ok(match row {
        Some(row) => {
            json!({"state":row.get::<_, String>(0),"providerAccepted":row.get::<_, bool>(1)})
        }
        None => json!({"state":"not_attempted","providerAccepted":false}),
    })
}

/// A signed callback can arrive before the HTTP send response is recorded.
/// Correlation comes only from our durable attempted intent and frozen review.
pub(crate) async fn correlate(pool: &Pool, event: &Incoming) -> Result<(u64, u64, u64)> {
    let raw = &event.payload;
    let provider = raw
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= 255)
        .ok_or_else(|| anyhow::anyhow!("invalid callback message id"))?;
    let recipient = raw
        .get("recipient_id")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("callback recipient is unavailable"))?;
    let opaque = raw
        .get("biz_opaque_callback_data")
        .and_then(Value::as_str)
        .filter(|key| key.len() == 64 && key.bytes().all(|b| b.is_ascii_hexdigit()));
    let mut client = pool.get().await?;
    let tx = client.transaction().await?;
    let rows = tx.query(
        "SELECT o.intent_key,o.provider_message_id,r.company_id,r.conversation_id, \
                r.conversation_message_id,r.operational_message_id,r.recipient \
         FROM lumiere_whatsapp.outbox o JOIN lumiere_whatsapp.dispatch_review r ON r.id=o.review_digest \
         AND r.organization_id=o.organization_id AND r.company_id=o.company_id AND r.account_id=o.account_id \
         AND r.operational_message_id=o.operational_message_id \
         WHERE o.organization_id=$1 AND o.account_id=$2 AND o.state IN ('attempted','unknown','accepted') \
         AND (($3::text IS NOT NULL AND o.intent_key=$3) OR ($3::text IS NULL AND o.provider_message_id=$4)) \
         LIMIT 2 FOR UPDATE OF o",
        &[&event.organization_id.to_string(), &event.account_id.to_string(), &opaque, &provider],
    ).await?;
    let [row] = rows.as_slice() else {
        bail!("provider correlation is missing or ambiguous");
    };
    let company: u64 = row.get::<_, String>(2).parse()?;
    let bound: Option<String> = row.get(1);
    if event.company_id.is_some_and(|id| id != company)
        || row.get::<_, String>(6) != recipient
        || bound.as_deref().is_some_and(|id| id != provider)
    {
        bail!("provider correlation scope or recipient mismatch");
    }
    let duplicate = tx
        .query_opt(
            "SELECT 1 FROM lumiere_whatsapp.outbox WHERE organization_id=$1 AND account_id=$2 \
         AND provider_message_id=$3 AND intent_key<>$4 LIMIT 1",
            &[
                &event.organization_id.to_string(),
                &event.account_id.to_string(),
                &provider,
                &row.get::<_, String>(0),
            ],
        )
        .await?;
    if duplicate.is_some() {
        bail!("provider id is already bound to another intent");
    }
    tx.execute(
        "UPDATE lumiere_whatsapp.outbox SET state='accepted',provider_message_id=$2,finished_at=now() \
         WHERE intent_key=$1 AND state IN ('attempted','unknown','accepted')",
        &[&row.get::<_, String>(0), &provider],
    ).await?;
    let ids = (
        row.get::<_, String>(3).parse()?,
        row.get::<_, String>(4).parse()?,
        row.get::<_, String>(5).parse()?,
    );
    tx.commit().await?;
    Ok(ids)
}
