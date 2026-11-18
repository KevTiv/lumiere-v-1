//! Durable, credential-free queue of ERP records awaiting AI indexing (AIH-30).
//!
//! A job names an actor and a record, never a token. It is executed only while
//! that same actor presents a live session, so projection keeps the actor's
//! field-level permissions and no long-lived bearer credential is ever stored.
//! Enqueueing is best effort: it must never fail or delay the ERP write.

use deadpool_postgres::Pool;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use stdb_client::ReducerContract;

use crate::session::normalize_identity_hex_for_sql;

/// Largest claim and report batch; matches the gateway ingest reference bound.
pub(crate) const MAX_BATCH: usize = 8;
const MAX_ATTEMPTS: i32 = 6;
const LEASE_SECS: i64 = 120;
const MAX_ERROR_LEN: usize = 200;

/// Session reducers that change an ingestible record and name it by id.
/// `(reducer, resource kind, id parameter)`. Creates return no id, so a new
/// record is queued by its first id-bearing follow-up write.
const WRITE_TARGETS: &[(&str, &str, &str)] = &[
    ("update_sale_order", "sale_order", "order_id"),
    ("accept_sale_order_quotation", "sale_order", "order_id"),
    ("send_sale_order_quotation", "sale_order", "order_id"),
    ("cancel_sale_order", "sale_order", "order_id"),
    ("lock_sale_order", "sale_order", "order_id"),
    ("unlock_sale_order", "sale_order", "order_id"),
    ("refresh_sale_order_promise_dates", "sale_order", "order_id"),
    ("update_purchase_order", "purchase_order", "order_id"),
    ("confirm_purchase_order", "purchase_order", "order_id"),
    ("send_purchase_order", "purchase_order", "order_id"),
    ("cancel_purchase_order", "purchase_order", "order_id"),
    ("lock_purchase_order", "purchase_order", "order_id"),
    ("unlock_purchase_order", "purchase_order", "order_id"),
    (
        "compute_purchase_order_totals",
        "purchase_order",
        "order_id",
    ),
    ("post_account_move", "account_move", "move_id"),
    ("cancel_account_move", "account_move", "move_id"),
    ("reset_account_move_to_draft", "account_move", "move_id"),
    ("update_task", "project_task", "task_id"),
    ("update_task_state", "project_task", "task_id"),
    ("assign_task_users", "project_task", "task_id"),
    ("set_task_parent", "project_task", "task_id"),
    ("update_product", "product", "product_id"),
    ("delete_product", "product", "product_id"),
    ("update_contact", "contact", "contact_id"),
    ("update_contact_address", "contact", "contact_id"),
    ("update_contact_business", "contact", "contact_id"),
    ("update_contact_details", "contact", "contact_id"),
    ("update_contact_parent", "contact", "contact_id"),
    ("delete_contact", "contact", "contact_id"),
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct IndexTarget {
    pub kind: &'static str,
    pub resource_id: u64,
    /// Present when the reducer itself names the company.
    pub company_id: Option<u64>,
    pub content_hash: String,
}

fn positive_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|id| *id > 0)
}

/// Resolve the record a committed reducer call changed, if it is ingestible.
pub(crate) fn indexable_target(contract: &ReducerContract, args: &[Value]) -> Option<IndexTarget> {
    let (_, kind, id_param) = WRITE_TARGETS
        .iter()
        .find(|(reducer, _, _)| *reducer == contract.name)?;
    let value_of = |name: &str| {
        contract
            .params
            .iter()
            .position(|parameter| parameter.name == name)
            .and_then(|position| args.get(position))
    };
    let resource_id = positive_u64(value_of(id_param)?)?;
    let company_id = value_of("company_id").and_then(positive_u64);
    let mut hasher = Sha256::new();
    hasher.update(contract.name.as_bytes());
    hasher.update([0]);
    hasher.update(serde_json::to_vec(args).ok()?);
    Some(IndexTarget {
        kind,
        resource_id,
        company_id,
        content_hash: format!("{:x}", hasher.finalize()),
    })
}

/// Exponential retry delay: 30 s, 60 s, ... capped at one hour.
pub(crate) fn retry_delay_secs(attempt: i32) -> i64 {
    30i64
        .saturating_mul(1i64 << (attempt.clamp(1, 12) - 1))
        .min(3600)
}

fn clean_error(error: &str) -> String {
    error
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_ERROR_LEN)
        .collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaimedJob {
    pub id: i64,
    pub company_id: u64,
    pub resource_kind: String,
    pub resource_id: u64,
    pub content_hash: String,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum JobOutcome {
    Indexed,
    Unchanged,
    Withheld,
    Failed,
}

impl JobOutcome {
    fn terminal_status(self) -> Option<&'static str> {
        match self {
            Self::Indexed => Some("indexed"),
            Self::Unchanged => Some("unchanged"),
            Self::Withheld => Some("withheld"),
            Self::Failed => None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct JobReport {
    pub id: i64,
    pub content_hash: String,
    pub outcome: JobOutcome,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueueSummary {
    pub pending: i64,
    pub indexed: i64,
    pub unchanged: i64,
    pub withheld: i64,
    pub failed: i64,
    pub last_indexed_at: Option<String>,
}

pub(crate) async fn enqueue(
    pool: &Pool,
    organization_id: u64,
    company_id: u64,
    actor_identity: &str,
    target: &IndexTarget,
) -> anyhow::Result<()> {
    let actor_identity = normalize_identity_hex_for_sql(actor_identity);
    let actor_identity = actor_identity.as_str();
    let client = pool.get().await?;
    client
        .execute(
            "INSERT INTO lumiere_platform.ai_index_job \
             (organization_id, company_id, actor_identity, resource_kind, resource_id, content_hash) \
             VALUES ($1::text::numeric, $2::text::numeric, $3, $4, $5::text::numeric, $6) \
             ON CONFLICT (organization_id, company_id, actor_identity, resource_kind, resource_id) \
             WHERE status = 'pending' \
             DO UPDATE SET content_hash = EXCLUDED.content_hash, updated_at = now(), \
                           next_attempt_at = now(), claimed_until = NULL, last_error = NULL",
            &[
                &organization_id.to_string(),
                &company_id.to_string(),
                &actor_identity,
                &target.kind,
                &target.resource_id.to_string(),
                &target.content_hash,
            ],
        )
        .await?;
    Ok(())
}

/// Lease up to `limit` due jobs that belong to this actor only.
pub(crate) async fn claim_for_actor(
    pool: &Pool,
    organization_id: u64,
    actor_identity: &str,
    limit: usize,
) -> anyhow::Result<Vec<ClaimedJob>> {
    let limit = limit.clamp(1, MAX_BATCH) as i64;
    let actor_identity = normalize_identity_hex_for_sql(actor_identity);
    let actor_identity = actor_identity.as_str();
    let client = pool.get().await?;
    let rows = client
        .query(
            "WITH picked AS ( \
               SELECT id FROM lumiere_platform.ai_index_job \
               WHERE organization_id = $1::text::numeric AND actor_identity = $2 \
                 AND status = 'pending' AND next_attempt_at <= now() \
                 AND (claimed_until IS NULL OR claimed_until < now()) \
               ORDER BY id LIMIT $3 FOR UPDATE SKIP LOCKED) \
             UPDATE lumiere_platform.ai_index_job job \
             SET claimed_until = now() + make_interval(secs => $4), \
                 attempt_count = attempt_count + 1, updated_at = now() \
             FROM picked WHERE job.id = picked.id \
             RETURNING job.id, job.company_id::text AS company_id, job.resource_kind, \
                       job.resource_id::text AS resource_id, job.content_hash",
            &[
                &organization_id.to_string(),
                &actor_identity,
                &limit,
                &(LEASE_SECS as f64),
            ],
        )
        .await?;
    let mut jobs = rows
        .iter()
        .map(|row| {
            Ok(ClaimedJob {
                id: row.get("id"),
                company_id: row.get::<_, String>("company_id").parse()?,
                resource_kind: row.get("resource_kind"),
                resource_id: row.get::<_, String>("resource_id").parse()?,
                content_hash: row.get("content_hash"),
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    jobs.sort_by_key(|job| job.id);
    Ok(jobs)
}

/// Record outcomes. A job whose hash changed since it was claimed (a newer write
/// landed meanwhile) stays pending so the newer state is indexed too.
pub(crate) async fn report(
    pool: &Pool,
    organization_id: u64,
    actor_identity: &str,
    reports: &[JobReport],
) -> anyhow::Result<usize> {
    let actor_identity = normalize_identity_hex_for_sql(actor_identity);
    let actor_identity = actor_identity.as_str();
    let mut client = pool.get().await?;
    let tx = client.transaction().await?;
    let mut applied = 0;
    for report in reports.iter().take(MAX_BATCH) {
        let org = organization_id.to_string();
        if let Some(status) = report.outcome.terminal_status() {
            applied += tx
                .execute(
                    "UPDATE lumiere_platform.ai_index_job \
                     SET status = $5, last_error = NULL, claimed_until = NULL, \
                         completed_at = now(), updated_at = now() \
                     WHERE id = $1 AND organization_id = $2::text::numeric AND actor_identity = $3 \
                       AND status = 'pending' AND content_hash = $4",
                    &[
                        &report.id,
                        &org,
                        &actor_identity,
                        &report.content_hash,
                        &status,
                    ],
                )
                .await? as usize;
            continue;
        }
        let Some(row) = tx
            .query_opt(
                "SELECT attempt_count, content_hash FROM lumiere_platform.ai_index_job \
                 WHERE id = $1 AND organization_id = $2::text::numeric AND actor_identity = $3 \
                   AND status = 'pending' FOR UPDATE",
                &[&report.id, &org, &actor_identity],
            )
            .await?
        else {
            continue;
        };
        let attempts: i32 = row.get(0);
        let error = clean_error(report.error.as_deref().unwrap_or("indexing failed"));
        if attempts >= MAX_ATTEMPTS {
            applied += tx
                .execute(
                    "UPDATE lumiere_platform.ai_index_job SET status = 'failed', last_error = $2, \
                     claimed_until = NULL, completed_at = now(), updated_at = now() WHERE id = $1",
                    &[&report.id, &error],
                )
                .await? as usize;
        } else {
            applied += tx
                .execute(
                    "UPDATE lumiere_platform.ai_index_job SET last_error = $2, claimed_until = NULL, \
                     next_attempt_at = now() + make_interval(secs => $3), updated_at = now() \
                     WHERE id = $1",
                    &[&report.id, &error, &(retry_delay_secs(attempts) as f64)],
                )
                .await? as usize;
        }
    }
    tx.commit().await?;
    Ok(applied)
}

pub(crate) async fn summary(
    pool: &Pool,
    organization_id: u64,
    company_id: u64,
) -> anyhow::Result<QueueSummary> {
    let client = pool.get().await?;
    let rows = client
        .query(
            "SELECT status, count(*)::bigint AS n, max(completed_at)::text AS last \
             FROM lumiere_platform.ai_index_job \
             WHERE organization_id = $1::text::numeric AND company_id = $2::text::numeric \
             GROUP BY status",
            &[&organization_id.to_string(), &company_id.to_string()],
        )
        .await?;
    let mut summary = QueueSummary::default();
    for row in rows {
        let status: String = row.get("status");
        let n: i64 = row.get("n");
        match status.as_str() {
            "pending" => summary.pending = n,
            "indexed" => summary.indexed = n,
            "unchanged" => summary.unchanged = n,
            "withheld" => summary.withheld = n,
            "failed" => summary.failed = n,
            _ => {}
        }
        if matches!(status.as_str(), "indexed" | "unchanged") {
            let last: Option<String> = row.get("last");
            if last > summary.last_indexed_at {
                summary.last_indexed_at = last;
            }
        }
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn contract(name: &str) -> &'static ReducerContract {
        stdb_client::reducer_contract(name).expect("reducer in the pinned contract")
    }

    #[test]
    fn every_write_target_is_a_session_reducer_with_its_id_parameter() {
        for (reducer, kind, id_param) in WRITE_TARGETS {
            let contract = contract(reducer);
            assert_eq!(
                contract.exposure,
                stdb_client::Exposure::Session,
                "{reducer}"
            );
            assert!(
                contract.params.iter().any(|p| p.name == *id_param),
                "{reducer} lacks {id_param}"
            );
            assert!(
                matches!(
                    *kind,
                    "sale_order"
                        | "purchase_order"
                        | "project_task"
                        | "account_move"
                        | "product"
                        | "contact"
                ),
                "{kind}"
            );
        }
    }

    #[test]
    fn update_enqueues_the_named_record_and_company() {
        let contract = contract("update_sale_order");
        let mut args = vec![Value::Null; contract.params.len()];
        for (index, parameter) in contract.params.iter().enumerate() {
            args[index] = match parameter.name {
                "organization_id" => json!(7),
                "company_id" => json!(3),
                "order_id" => json!(42),
                _ => json!({}),
            };
        }
        let target = indexable_target(contract, &args).expect("ingestible write");
        assert_eq!(target.kind, "sale_order");
        assert_eq!(target.resource_id, 42);
        assert_eq!(target.company_id, Some(3));
        assert_eq!(target.content_hash.len(), 64);
        args[contract
            .params
            .iter()
            .position(|p| p.name == "params")
            .unwrap()] = json!({"note": "changed"});
        assert_ne!(
            indexable_target(contract, &args).unwrap().content_hash,
            target.content_hash
        );
    }

    #[test]
    fn creates_and_unrelated_reducers_are_not_enqueued() {
        for name in ["create_sale_order", "create_contact", "create_product"] {
            let contract = contract(name);
            let args = vec![json!(1); contract.params.len()];
            assert!(indexable_target(contract, &args).is_none(), "{name}");
        }
        let contract = contract("update_sale_order_line");
        assert!(indexable_target(contract, &vec![json!(1); contract.params.len()]).is_none());
    }

    #[test]
    fn zero_or_malformed_ids_are_rejected() {
        let contract = contract("update_product");
        for id in [json!(0), json!("abc"), json!(-1), Value::Null] {
            let args: Vec<Value> = contract
                .params
                .iter()
                .map(|p| {
                    if p.name == "product_id" {
                        id.clone()
                    } else {
                        json!(1)
                    }
                })
                .collect();
            assert!(indexable_target(contract, &args).is_none());
        }
    }

    #[test]
    fn retry_delay_backs_off_and_is_capped() {
        assert_eq!(retry_delay_secs(1), 30);
        assert_eq!(retry_delay_secs(2), 60);
        assert_eq!(retry_delay_secs(3), 120);
        assert_eq!(retry_delay_secs(8), 3600);
        assert_eq!(retry_delay_secs(1000), 3600);
        assert_eq!(retry_delay_secs(0), 30);
    }

    #[test]
    fn stored_error_is_bounded_and_single_line() {
        let long = format!("bad\n{}", "x".repeat(500));
        let cleaned = clean_error(&long);
        assert_eq!(cleaned.len(), MAX_ERROR_LEN);
        assert!(!cleaned.contains('\n'));
    }

    #[test]
    fn report_rejects_unknown_fields_and_outcomes() {
        assert!(serde_json::from_value::<JobReport>(
            json!({"id": 1, "contentHash": "a", "outcome": "indexed", "token": "x"})
        )
        .is_err());
        assert!(serde_json::from_value::<JobReport>(
            json!({"id": 1, "contentHash": "a", "outcome": "pending"})
        )
        .is_err());
        assert_eq!(
            serde_json::from_value::<JobReport>(
                json!({"id": 1, "contentHash": "a", "outcome": "withheld"})
            )
            .unwrap()
            .outcome,
            JobOutcome::Withheld
        );
    }
}
