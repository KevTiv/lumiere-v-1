//! Durable transport inbox, separate from authoritative ERP state.
use anyhow::{bail, Context, Result};
use deadpool_postgres::Pool;
use sha2::{Digest, Sha256};

use super::protocol::{Incoming, MAX_EVENTS};

const SQL: &str = include_str!("schema.sql");

fn checksum() -> String {
    hex::encode(Sha256::digest(SQL.as_bytes()))
}

/// Explicit administrative migration only. Runtime paths never create DDL.
/// This private transport schema has its own immutable version ledger and
/// does not edit the released ERP projection migration catalog.
pub(super) async fn migrate(pool: &Pool) -> Result<()> {
    let mut client = pool.get().await?;
    let tx = client.transaction().await?;
    tx.batch_execute(
        "SELECT pg_advisory_xact_lock(736194211); \
         CREATE SCHEMA IF NOT EXISTS lumiere_whatsapp; \
         REVOKE ALL ON SCHEMA lumiere_whatsapp FROM PUBLIC; \
         CREATE TABLE IF NOT EXISTS lumiere_whatsapp.schema_version \
         (version integer PRIMARY KEY, checksum text NOT NULL);",
    )
    .await?;
    let rows = tx
        .query("SELECT version, checksum FROM lumiere_whatsapp.schema_version", &[])
        .await?;
    if rows.is_empty() {
        tx.batch_execute(SQL).await?;
        tx.execute(
            "INSERT INTO lumiere_whatsapp.schema_version (version, checksum) VALUES (1, $1)",
            &[&checksum()],
        )
        .await?;
    } else if rows.len() != 1
        || rows[0].get::<_, i32>(0) != 1
        || rows[0].get::<_, String>(1) != checksum()
    {
        bail!("whatsapp transport migration lineage mismatch");
    }
    tx.commit().await?;
    Ok(())
}

pub(super) async fn verify(pool: &Pool) -> Result<()> {
    let client = pool.get().await?;
    let rows = client
        .query("SELECT version, checksum FROM lumiere_whatsapp.schema_version", &[])
        .await
        .context("whatsapp transport schema is not installed")?;
    if rows.len() != 1
        || rows[0].get::<_, i32>(0) != 1
        || rows[0].get::<_, String>(1) != checksum()
    {
        bail!("whatsapp transport migration lineage mismatch");
    }
    Ok(())
}

/// Commit the entire verified batch before acknowledging Meta. Conflicting
/// payloads are retained in quarantine, never substituted for the original.
pub(super) async fn persist(pool: &Pool, events: &[Incoming]) -> Result<()> {
    if events.is_empty() || events.len() > MAX_EVENTS {
        bail!("invalid whatsapp inbox batch size");
    }
    verify(pool).await?;
    let mut client = pool.get().await?;
    let tx = client.transaction().await?;
    let mut ordered: Vec<_> = events.iter().collect();
    ordered.sort_by(|left, right| {
        (left.organization_id, left.account_id, &left.event_key)
            .cmp(&(right.organization_id, right.account_id, &right.event_key))
    });
    for event in ordered {
        let org = event.organization_id.to_string();
        let account = event.account_id.to_string();
        let company = event.company_id.map(|id| id.to_string());
        let lock_key = format!("meta-inbox:{org}:{account}");
        tx.query_one("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", &[&lock_key])
            .await?;
        let duplicate = tx
            .query_opt(
                "SELECT 1 FROM lumiere_whatsapp.inbox WHERE organization_id=$1 \
                 AND account_id=$2 AND event_key=$3 AND fingerprint=$4",
                &[&org, &account, &event.event_key, &event.fingerprint],
            )
            .await?;
        if duplicate.is_some() {
            continue;
        }
        let backlog: i64 = tx
            .query_one(
                "SELECT count(*) FROM (SELECT 1 FROM lumiere_whatsapp.inbox \
                 WHERE organization_id=$1 AND account_id=$2 AND state<>'processed' \
                 LIMIT 10000) AS pending",
                &[&org, &account],
            )
            .await?
            .get(0);
        if backlog >= 10000 {
            bail!("whatsapp account inbox capacity exceeded");
        }
        let conflict = tx
            .query_opt(
                "SELECT 1 FROM lumiere_whatsapp.inbox \
                 WHERE organization_id=$1 AND account_id=$2 AND event_key=$3 \
                 AND fingerprint<>$4 LIMIT 1",
                &[&org, &account, &event.event_key, &event.fingerprint],
            )
            .await?
            .is_some();
        let state = if conflict { "quarantined" } else { "pending" };
        let reason: Option<&str> = conflict.then_some("conflicting_provider_event");
        let encoded = serde_json::to_string(event)?;
        tx.execute(
            "INSERT INTO lumiere_whatsapp.inbox \
             (organization_id,account_id,company_id,event_key,fingerprint,event_json,state,reason_code) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) \
             ON CONFLICT (organization_id,account_id,event_key,fingerprint) DO NOTHING",
            &[&org, &account, &company, &event.event_key, &event.fingerprint, &encoded, &state, &reason],
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub(super) struct Lease {
    pub id: i64,
    pub token: String,
    pub attempts: i32,
    pub event_json: String,
}

pub(super) async fn claim(pool: &Pool) -> Result<Option<Lease>> {
    let mut client = pool.get().await?;
    let tx = client.transaction().await?;
    let token = hex::encode(rand::random::<[u8; 32]>());
    let row = tx
        .query_opt(
            "WITH candidate AS ( \
             SELECT id FROM lumiere_whatsapp.inbox \
             WHERE (state IN ('pending','retry') AND next_attempt_at<=now()) \
                OR (state='processing' AND lease_until<now()) \
             ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) \
             UPDATE lumiere_whatsapp.inbox AS item \
             SET state='processing',lease_token=$1,lease_until=now()+interval '60 seconds', \
                 attempts=item.attempts+1,updated_at=now() \
             FROM candidate WHERE item.id=candidate.id \
             RETURNING item.id,item.attempts,item.event_json",
            &[&token],
        )
        .await?;
    let lease = row.map(|row| Lease {
        id: row.get(0),
        token,
        attempts: row.get(1),
        event_json: row.get(2),
    });
    if let Some(lease) = &lease {
        tx.execute(
            "INSERT INTO lumiere_whatsapp.inbox_attempt \
             (inbox_id,lease_token,outcome,reason_code) VALUES ($1,$2,'started','claimed')",
            &[&lease.id, &lease.token],
        )
        .await?;
    }
    tx.commit().await?;
    Ok(lease)
}

#[derive(Clone, Copy)]
pub(super) enum Outcome {
    Processed,
    Retry,
    Quarantined,
}

pub(super) async fn finish(pool: &Pool, lease: &Lease, outcome: Outcome, reason: &str) -> Result<()> {
    let state = match outcome {
        Outcome::Processed => "processed",
        Outcome::Retry if lease.attempts < 10 => "retry",
        Outcome::Retry | Outcome::Quarantined => "quarantined",
    };
    let seconds: i32 = 5 * (1_i32 << lease.attempts.clamp(0, 7));
    let mut client = pool.get().await?;
    let tx = client.transaction().await?;
    let changed = tx
        .execute(
            "UPDATE lumiere_whatsapp.inbox SET state=$3,reason_code=$4,updated_at=now(), \
             next_attempt_at=now()+($5::integer * interval '1 second'),lease_token=NULL,lease_until=NULL \
             WHERE id=$1 AND lease_token=$2 AND state='processing'",
            &[&lease.id, &lease.token, &state, &reason, &seconds],
        )
        .await?;
    if changed != 1 {
        bail!("whatsapp inbox lease was superseded");
    }
    tx.execute(
        "INSERT INTO lumiere_whatsapp.inbox_attempt \
         (inbox_id,lease_token,outcome,reason_code) VALUES ($1,$2,$3,$4)",
        &[&lease.id, &lease.token, &state, &reason],
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Operator retry is scoped and audited. It cannot replay processed events or
/// revive conflicting payloads. Canonical CRM validation still runs afterward.
pub(super) async fn requeue(pool: &Pool, org: u64, account: u64, id: i64) -> Result<()> {
    let mut client = pool.get().await?;
    let tx = client.transaction().await?;
    let changed = tx
        .execute(
            "UPDATE lumiere_whatsapp.inbox SET state='pending',next_attempt_at=now(),updated_at=now() \
             WHERE id=$1 AND organization_id=$2 AND account_id=$3 AND state='quarantined' \
             AND reason_code IS DISTINCT FROM 'conflicting_provider_event'",
            &[&id, &org.to_string(), &account.to_string()],
        )
        .await?;
    if changed != 1 {
        bail!("whatsapp event is not eligible for scoped retry");
    }
    tx.execute(
        "INSERT INTO lumiere_whatsapp.inbox_attempt \
         (inbox_id,lease_token,outcome,reason_code) VALUES ($1,'operator','pending','operator_requeue')",
        &[&id],
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests;
