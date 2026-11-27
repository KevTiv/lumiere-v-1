use std::{collections::BTreeSet, sync::Arc, time::Duration};

use deadpool_postgres::Pool;
use rand::{rngs::OsRng, RngCore};
use serde_json::Value;

use super::{authorize, execute, sql_only, storage, ChunkReceipt, RunChunk, RunGroup};
use crate::{
    auth_password::decrypt_token, cold_tier::pg_pool, error::ApiError, platform_control,
    session::{load_field_access_context, parse_stdb_identity_hex, ApiSession}, state::AppState,
};

const ATTEMPT_LIMIT: i32 = 8;
const DEADLINE: Duration = Duration::from_secs(90);

struct Job {
    group: RunGroup,
    chunk: RunChunk,
    organization: u64,
    company: u64,
    creator: String,
    actor: String,
    platform_user: String,
    token: String,
    attempts: i32,
}

/// Reload the current canonical principal under the original approval. Jobs
/// never retain browser credentials or execute under server authority.
pub(super) async fn stored_session(state: &AppState, actor: &str, organization: u64, platform_user: &str) -> Result<ApiSession,ApiError> {
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let credential = platform_control::find_user_credential_by_stdb_identity(pool,actor)
        .await.map_err(ApiError::internal)?.ok_or(ApiError::Unauthorized)?;
    if credential.get::<_,String>("platform_user_id") != platform_user {
        return Err(ApiError::Unauthorized);
    }
    let key = state.config.stdb_credential_encryption_key.as_ref()
        .ok_or_else(|| ApiError::Unavailable("durable principal credentials unavailable".into()))?;
    let token = decrypt_token(key,&credential.get::<_,String>("stdb_token_enc"))?;
    if token.is_empty() || state.config.stdb_server_token.as_deref() == Some(token.as_str())
        || state.config.stdb_finalization_token.as_deref() == Some(token.as_str()) {
        return Err(ApiError::Unauthorized);
    }
    let actual = state.client_with_token(&token).authenticated_identity().await
        .map_err(|_| ApiError::Unavailable("could not verify the saved operator credential".into()))?;
    if parse_stdb_identity_hex(&actual).as_deref() != Some(actor) {
        return Err(ApiError::Unauthorized);
    }
    let access = load_field_access_context(&state.stdb,actor,organization).await
        .map_err(ApiError::Internal)?.ok_or(ApiError::Unauthorized)?;
    if access.organization_id != organization || access.identity_hex != actor {
        return Err(ApiError::Unauthorized);
    }
    Ok(ApiSession { stdb_token:token,identity_hex:actor.to_owned(),organization_id:Some(organization),field_access:Some(access) })
}

async fn claim(pool: &Pool) -> Result<Option<Job>,ApiError> {
    let client = pool.get().await.map_err(ApiError::internal)?;
    let mut entropy = [0;16];
    OsRng.fill_bytes(&mut entropy);
    let token = hex::encode(entropy);
    let row = client.query_opt(
        "WITH next AS (
            SELECT chunk.id FROM lumiere_platform.import_run_chunk chunk
            JOIN lumiere_platform.import_run run ON run.id=chunk.run_id
            WHERE ((chunk.status='queued' AND chunk.available_at<=now())
                OR (chunk.status='running' AND chunk.lease_until<=now()))
              AND NOT EXISTS (SELECT 1 FROM lumiere_platform.import_run_chunk earlier
                  WHERE earlier.run_id=chunk.run_id AND earlier.ordinal<chunk.ordinal
                    AND (earlier.status IN ('queued','running') OR (earlier.status='blocked' AND earlier.receipt IS NULL)))
              AND NOT EXISTS (SELECT 1 FROM lumiere_platform.import_run_chunk dependency
                  WHERE dependency.run_id=ANY(run.depends_on) AND dependency.status<>'verified')
            ORDER BY chunk.available_at,run.created_at,chunk.ordinal LIMIT 1 FOR UPDATE OF chunk SKIP LOCKED
         )
         UPDATE lumiere_platform.import_run_chunk chunk
            SET status='running',attempts=attempts+1,lease_token=$1,lease_until=now()+interval '120 seconds'
            FROM next,lumiere_platform.import_run run WHERE chunk.id=next.id AND run.id=chunk.run_id
         RETURNING chunk.id,chunk.ordinal,chunk.source_rows,chunk.attempts,
             run.id AS run_id,run.task_id,run.organization_id::text,run.company_id::text,
             run.creator_identity,run.approved_by,run.platform_user_id,run.adapter,run.config,run.source_rows AS group_rows",
        &[&token],
    ).await.map_err(ApiError::internal)?;
    let Some(row) = row else { return Ok(None); };
    let org: String = row.get("organization_id");
    let company: String = row.get("company_id");
    Ok(Some(Job {
        group: RunGroup { id:row.get("run_id"),task_id:row.get("task_id"),adapter:row.get("adapter"),config:row.get("config"),
            rows:serde_json::from_value(row.get("group_rows")).map_err(ApiError::internal)? },
        chunk: RunChunk { id:row.get("id"),ordinal:row.get("ordinal"),
            rows:serde_json::from_value(row.get("source_rows")).map_err(ApiError::internal)? },
        organization:org.parse().map_err(ApiError::internal)?,
        company:company.parse().map_err(ApiError::internal)?,
        creator:row.get("creator_identity"),actor:row.get("approved_by"),platform_user:row.get("platform_user_id"),
        token,attempts:row.get("attempts"),
    }))
}

struct Outcome {
    status: &'static str,
    verified: Vec<i64>,
    receipt: Option<Value>,
    error: Option<&'static str>,
    delay_seconds: i32,
}

fn verify_receipt(receipt: ChunkReceipt, chunk: &RunChunk) -> Result<Outcome,ApiError> {
    let allowed = chunk.rows.iter().map(|r|r.item_id).collect::<BTreeSet<_>>();
    let invalid = || ApiError::Unavailable("native import requires exact row readback".into());
    let verified = receipt.result["verifiedItemIds"].as_array().and_then(|ids|
        ids.iter().map(|id|id.as_str()?.parse::<i64>().ok()).collect::<Option<Vec<_>>>()
    ).ok_or_else(invalid)?;
    let failed = receipt.result["failedRows"].as_u64().ok_or_else(invalid)?;
    let held = receipt.result["heldRows"].as_u64().ok_or_else(invalid)?;
    if verified.iter().any(|id| !allowed.contains(id))
        || verified.iter().collect::<BTreeSet<_>>().len() != verified.len()
        || (verified.len() as u64).checked_add(failed).and_then(|n|n.checked_add(held)) != Some(chunk.rows.len() as u64)
        || serde_json::to_vec(&receipt.result).map_err(ApiError::internal)?.len() > 128_000 {
        return Err(invalid());
    }
    let status = if verified.len() == chunk.rows.len() {"verified"} else if !verified.is_empty() {"partial"}
        else if failed>0 {"failed"} else {"blocked"};
    Ok(Outcome {status,verified,receipt:Some(receipt.result),error:None,delay_seconds:0})
}

fn failure(error: ApiError, attempts: i32) -> Outcome {
    let retry = matches!(&error,ApiError::Unavailable(_) | ApiError::UnavailableSource(_) | ApiError::RateLimited(_)
        | ApiError::Internal(_) | ApiError::InternalSource(_));
    let message = match error {
        ApiError::Forbidden(_) | ApiError::Unauthorized => "Approval access changed. Check the current reviewer.",
        ApiError::Conflict(_) | ApiError::NotFound(_) | ApiError::BadRequest(_) =>
            "The saved approval or its sources changed. Check the saved result.",
        _ => "Verification is unavailable. Check the saved result.",
    };
    Outcome {status:if retry && attempts<ATTEMPT_LIMIT {"queued"} else {"blocked"},verified:Vec::new(),
        receipt:None,error:Some(message),delay_seconds:2_i32.pow(attempts.clamp(0,7) as u32)}
}

async fn work(state: &AppState, pool: &Pool, job: &Job) -> Result<(),ApiError> {
    let authority = tokio::time::timeout(DEADLINE,async {
        let session = stored_session(state,&job.actor,job.organization,&job.platform_user).await?;
        let authority = authorize(state,session,job.company,&job.group.task_id).await?;
        if authority.organization_id != job.organization || authority.creator != job.creator || authority.actor != job.actor {
            return Err(ApiError::Forbidden("the approved task authority changed".into()));
        }
        Ok(authority)
    }).await.unwrap_or_else(|_| Err(ApiError::Unavailable("saved operator verification timed out".into())));
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    // A running worker holds the checkpoint lock. Other workers skip it even
    // if the lease expires. A crash releases the lock for exact replay.
    let locked = tx.query_opt("SELECT id FROM lumiere_platform.import_run_chunk
       WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now() FOR UPDATE",
       &[&job.chunk.id,&job.token]).await.map_err(ApiError::internal)?;
    if locked.is_none() {
        return Ok(());
    }
    let outcome = match authority {
        Err(error) => failure(error,job.attempts),
        Ok(authority) => {
            let run = async {
                if job.attempts > ATTEMPT_LIMIT {
                    return Err(ApiError::Unavailable("the pending outcome requires review".into()));
                }
                let scope = authority.storage_scope();
                if sql_only(&job.group.adapter) {
                    // Native reducer paths take their own dispatch locks in the
                    // existing task order. SQL-only backfill needs this guard.
                    tx.query_opt(
                        "SELECT request_id FROM lumiere_platform.import_task
                         WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric
                           AND actor_identity=$3 AND request_id=$4 FOR SHARE",
                        &[&scope.organization.to_string(), &scope.company.to_string(),
                          &scope.actor, &job.group.task_id],
                    ).await.map_err(ApiError::internal)?
                     .ok_or_else(|| ApiError::NotFound("saved import task unavailable".into()))?;
                    super::super::tasks::handoff::lock_grant(&tx,scope,&authority.actor,&job.group.task_id).await?;
                }
                storage::exact_rows(&tx,scope,&job.group.task_id,&job.chunk.rows).await?;
                execute(state,&authority,&job.group,&job.chunk).await.and_then(|receipt|verify_receipt(receipt,&job.chunk))
            };
            match tokio::time::timeout(DEADLINE,run).await {
                Ok(Ok(outcome)) => outcome,
                Ok(Err(error)) => failure(error,job.attempts),
                Err(_) => failure(ApiError::Unavailable("native outcome timed out".into()),job.attempts),
            }
        }
    };
    tx.execute("UPDATE lumiere_platform.import_run_chunk SET status=$3,verified_item_ids=$4,receipt=$5,last_error=$6,
       lease_token=NULL,lease_until=NULL,available_at=now()+make_interval(secs=>$7::int)
       WHERE id=$1 AND lease_token=$2",&[&job.chunk.id,&job.token,&outcome.status,&outcome.verified,
       &outcome.receipt,&outcome.error,&outcome.delay_seconds]).await.map_err(ApiError::internal)?;
    tx.commit().await.map_err(ApiError::internal)
}

pub(crate) fn start(state: Arc<AppState>) {
    if state.config.stdb_credential_encryption_key.is_none() {
        return;
    }
    tokio::spawn(async move {
        loop {
            let next = async {
                let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
                if let Some(job) = claim(pool).await? {
                    work(&state,pool,&job).await?;
                    Ok::<_,ApiError>(true)
                } else {
                    Ok(false)
                }
            }.await;
            match next {
                Ok(true) => tokio::task::yield_now().await,
                Ok(false) => tokio::time::sleep(Duration::from_secs(2)).await,
                Err(error) => {
                    tracing::warn!(error=%error,"approved import worker could not advance");
                    tokio::time::sleep(Duration::from_secs(10)).await;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::SourceRevision;
    use serde_json::json;

    #[test]
    fn receipt_counts_only_exact_selected_rows() {
        let chunk = RunChunk {id:"a".repeat(32),ordinal:0,rows:vec![
            SourceRevision {batch_id:1,item_id:3,revision:2},
            SourceRevision {batch_id:1,item_id:4,revision:2},
        ]};
        let check = |ids,failed,held| verify_receipt(ChunkReceipt {
            result:json!({"verifiedItemIds":ids,"failedRows":failed,"heldRows":held})
        },&chunk);
        assert_eq!(check(vec!["3"],0,1).expect("partial proof").status,"partial");
        for (ids,failed,held) in [(vec!["5"],0,1),(vec!["3","3"],0,0),(vec!["3"],0,0)] {
            assert!(check(ids,failed,held).is_err());
        }
    }

    #[test]
    fn retryable_failures_stop_at_budget_and_revocation_blocks() {
        assert_eq!(failure(ApiError::Unavailable("retry".into()),1).status,"queued");
        assert_eq!(failure(ApiError::Unavailable("retry".into()),ATTEMPT_LIMIT).status,"blocked");
        assert_eq!(failure(ApiError::Unauthorized,1).status,"blocked");
    }
}
