//! Atomic per-message claim and per-account rolling volume limits.
use anyhow::{bail, Result};
use deadpool_postgres::Pool;

use super::policy::ReviewedMessage;
use crate::routes::whatsapp_meta::store;

pub(super) async fn acquire(
    pool: &Pool,
    message: &ReviewedMessage,
    intent: &str,
    digest: &str,
    daily_limit: u32,
) -> Result<bool> {
    if daily_limit == 0 || daily_limit > 1000 {
        bail!("invalid WhatsApp alpha volume allowance");
    }
    store::verify(pool).await?;
    let mut client = pool.get().await?;
    let tx = client.transaction().await?;
    let org = message.organization_id.to_string();
    let company = message.company_id.to_string();
    let account = message.account_id.to_string();
    let operational = message.operational_message_id.to_string();
    tx.query_one(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        &[&format!("whatsapp-send:{org}:{account}")],
    )
    .await?;
    if tx
        .query_opt(
            "SELECT 1 FROM lumiere_whatsapp.dispatch_review \
             WHERE id=$1 AND organization_id=$2 AND company_id=$3 AND account_id=$4 \
             AND operational_message_id=$5 AND expires_at>now()",
            &[
                &message.review_digest,
                &org,
                &company,
                &account,
                &operational,
            ],
        )
        .await?
        .is_none()
    {
        bail!("WhatsApp review is expired or unavailable");
    }
    tx.execute(
        "INSERT INTO lumiere_whatsapp.outbox \
         (intent_key,organization_id,company_id,account_id,operational_message_id,review_digest,payload_digest) \
         VALUES ($1,$2,$3,$4,$5,$6,$7) \
         ON CONFLICT (organization_id,operational_message_id) DO NOTHING",
        &[&intent, &org, &company, &account, &operational, &message.review_digest, &digest],
    ).await?;
    let row = tx
        .query_one(
            "SELECT intent_key,payload_digest,state FROM lumiere_whatsapp.outbox \
             WHERE organization_id=$1 AND operational_message_id=$2 FOR UPDATE",
            &[&org, &operational],
        )
        .await?;
    if row.get::<_, String>(0) != intent || row.get::<_, String>(1) != digest {
        bail!("WhatsApp intent is bound to another review; do not resend");
    }
    if row.get::<_, String>(2) != "prepared" {
        return Ok(false);
    }
    let count = tx
        .query_one(
            "SELECT count(*),count(*) FILTER (WHERE attempted_at>now()-interval '1 minute') \
             FROM lumiere_whatsapp.outbox WHERE organization_id=$1 AND account_id=$2 \
             AND attempted_at>now()-interval '24 hours'",
            &[&org, &account],
        )
        .await?;
    if count.get::<_, i64>(0) >= i64::from(daily_limit) || count.get::<_, i64>(1) >= 20 {
        bail!("WhatsApp sender volume allowance is exhausted");
    }
    tx.execute(
        "UPDATE lumiere_whatsapp.outbox SET state='attempted',attempted_at=now() \
         WHERE intent_key=$1 AND state='prepared'",
        &[&intent],
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

#[cfg(test)]
#[path = "claim_tests.rs"]
mod tests;
