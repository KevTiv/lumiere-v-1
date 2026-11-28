use deadpool_postgres::Pool;
use serde_json::{json, Value};
use tokio_postgres::{Row, Transaction};

use super::{Approval, RunAuthority, RunChunk, RunGroup, SourceRevision, StorageScope};
use crate::error::ApiError;

pub(super) async fn exact_rows(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
    task: &str,
    rows: &[SourceRevision],
) -> Result<(), ApiError> {
    let ids = rows.iter().map(|r| r.item_id).collect::<Vec<_>>();
    let actual = tx.query(
        "SELECT item.id,item.batch_id,item.revision
           FROM lumiere_platform.import_review_item item
           JOIN lumiere_platform.import_task_review link
             ON link.organization_id=item.organization_id AND link.company_id=item.company_id AND link.batch_id=item.batch_id
           JOIN lumiere_platform.import_task task
             ON task.organization_id=link.organization_id AND task.company_id=link.company_id
              AND task.actor_identity=link.actor_identity AND task.request_id=link.request_id
          WHERE item.organization_id=$1::text::numeric AND item.company_id=$2::text::numeric
            AND link.actor_identity=$3 AND link.request_id=$4 AND item.id=ANY($5::bigint[])
            AND item.state<>'excluded' AND NOT link.from_inspection
            AND task.state='needs_review' AND task.approved_mode='prepare_import' FOR SHARE OF item",
        &[&scope.organization.to_string(),&scope.company.to_string(),&scope.actor,&task,&ids],
    ).await.map_err(ApiError::internal)?;
    let selected = actual
        .iter()
        .map(|r| {
            (
                r.get::<_, i64>("id"),
                (r.get::<_, i64>("batch_id"), r.get::<_, i32>("revision")),
            )
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    if selected.len() != rows.len()
        || rows
            .iter()
            .any(|r| selected.get(&r.item_id) != Some(&(r.batch_id, r.revision)))
    {
        return Err(ApiError::Conflict(
            "source revisions changed or are outside this prepared task".into(),
        ));
    }
    Ok(())
}

const REQUEST_LOOKUP: &str = "SELECT run_id FROM lumiere_platform.import_run_request
    WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND creator_identity=$3 AND task_id=$4 AND request_id=$5";

fn different_request() -> ApiError {
    ApiError::Conflict("approval request ID already identifies a different import group".into())
}

pub(super) async fn replay(
    pool: &Pool,
    scope: StorageScope<'_>,
    group: &RunGroup,
    request: &str,
) -> Result<Option<Value>, ApiError> {
    let client = pool.get().await.map_err(ApiError::internal)?;
    let row = client
        .query_opt(
            REQUEST_LOOKUP,
            &[
                &scope.organization.to_string(),
                &scope.company.to_string(),
                &scope.actor,
                &group.task_id,
                &request,
            ],
        )
        .await
        .map_err(ApiError::internal)?;
    if let Some(row) = row {
        if row.get::<_, String>(0) != group.id {
            return Err(different_request());
        }
        drop(client);
        return project(pool, scope, &group.task_id, Some(&group.id))
            .await
            .map(Some);
    }
    Ok(None)
}

pub(super) async fn approve(
    pool: &Pool,
    authority: &RunAuthority,
    group: &RunGroup,
    chunks: &[RunChunk],
    body: &Approval,
    platform_user: &str,
) -> Result<(), ApiError> {
    let scope = authority.storage_scope();
    let org = scope.organization.to_string();
    let company = scope.company.to_string();
    let task = &group.task_id;
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    tx.query_opt("SELECT request_id FROM lumiere_platform.import_task
       WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4 FOR NO KEY UPDATE",
       &[&org,&company,&scope.actor,task]).await.map_err(ApiError::internal)?
       .ok_or_else(|| ApiError::NotFound("import task not found".into()))?;
    super::super::tasks::handoff::lock_grant(&tx, scope, &authority.actor, task).await?;
    let rows = json!(group.rows);
    let created = tx.execute("INSERT INTO lumiere_platform.import_run
          (id,organization_id,company_id,creator_identity,task_id,approved_by,platform_user_id,adapter,config,source_rows,depends_on)
        VALUES ($1,$2::text::numeric,$3::text::numeric,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING",
        &[&group.id,&org,&company,&scope.actor,task,&authority.actor,&platform_user,&group.adapter,&group.config,&rows,&body.depends_on])
        .await.map_err(ApiError::internal)?;
    if created == 0 {
        if tx.query_opt("SELECT id FROM lumiere_platform.import_run WHERE id=$1 AND organization_id=$2::text::numeric
          AND company_id=$3::text::numeric AND creator_identity=$4 AND task_id=$5 AND adapter=$6 AND config=$7 AND source_rows=$8 AND depends_on=$9",
          &[&group.id,&org,&company,&scope.actor,task,&group.adapter,&group.config,&rows,&body.depends_on])
          .await.map_err(ApiError::internal)?.is_none() {
            return Err(ApiError::Conflict("approved import group identity conflict".into()));
        }
    } else {
        exact_rows(&tx, scope, task, &group.rows).await?;
        let count: i64 = tx.query_one("SELECT count(*) FROM lumiere_platform.import_run WHERE id=ANY($1::text[]) AND id<>$2
              AND organization_id=$3::text::numeric AND company_id=$4::text::numeric AND creator_identity=$5 AND task_id=$6",
          &[&body.depends_on,&group.id,&org,&company,&scope.actor,task]).await.map_err(ApiError::internal)?.get(0);
        if count != body.depends_on.len() as i64 {
            return Err(ApiError::BadRequest(
                "choose dependencies from this same saved task".into(),
            ));
        }
        let ids = group.rows.iter().map(|r| r.item_id).collect::<Vec<_>>();
        let claimed = tx.execute("INSERT INTO lumiere_platform.import_run_source_claim
           (organization_id,company_id,creator_identity,task_id,adapter,item_id,run_id)
           SELECT $1::text::numeric,$2::text::numeric,$3,$4,$5,item,$6 FROM unnest($7::bigint[]) AS item
           ON CONFLICT DO NOTHING",&[&org,&company,&scope.actor,task,&group.adapter,&group.id,&ids]).await.map_err(ApiError::internal)?;
        if claimed as usize != ids.len() {
            return Err(ApiError::Conflict(
                "some source rows already belong to an approved run".into(),
            ));
        }
        for chunk in chunks {
            tx.execute("INSERT INTO lumiere_platform.import_run_chunk(id,run_id,ordinal,source_rows) VALUES ($1,$2,$3,$4)",
              &[&chunk.id,&group.id,&chunk.ordinal,&json!(chunk.rows)]).await.map_err(ApiError::internal)?;
        }
    }
    tx.execute("INSERT INTO lumiere_platform.import_run_request(organization_id,company_id,creator_identity,task_id,request_id,run_id)
          VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      &[&org,&company,&scope.actor,task,&body.request_id,&group.id]).await.map_err(ApiError::internal)?;
    let bound: String = tx
        .query_one(
            REQUEST_LOOKUP,
            &[&org, &company, &scope.actor, task, &body.request_id],
        )
        .await
        .map_err(ApiError::internal)?
        .get(0);
    if bound != group.id {
        return Err(different_request());
    }
    tx.commit().await.map_err(ApiError::internal)
}

pub(super) async fn project(
    pool: &Pool,
    scope: StorageScope<'_>,
    task: &str,
    run: Option<&str>,
) -> Result<Value, ApiError> {
    let client = pool.get().await.map_err(ApiError::internal)?;
    let org = scope.organization.to_string();
    let company = scope.company.to_string();
    let rows = client.query("SELECT id,task_id,adapter,approved_by,created_at::text,
          EXISTS (SELECT 1 FROM lumiere_platform.import_run_chunk dep
                  WHERE dep.run_id=ANY(depends_on) AND dep.status IN ('blocked','failed','partial')) AS dependency_blocked
        FROM lumiere_platform.import_run WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric
          AND creator_identity=$3 AND task_id=$4 AND ($5::text IS NULL OR id=$5)
        ORDER BY created_at DESC,id DESC LIMIT 11",&[&org,&company,&scope.actor,&task,&run]).await.map_err(ApiError::internal)?;
    let more = rows.len() > 10;
    let mut result = Vec::with_capacity(rows.len().min(10));
    for row in rows.into_iter().take(10) {
        result.push(run_view(&client, row, run.is_some()).await?);
    }
    if run.is_some() {
        return result
            .pop()
            .ok_or_else(|| ApiError::NotFound("approved import run not found".into()));
    }
    let row = client.query_one(
        "WITH items AS (
             SELECT DISTINCT item.id,item.revision,item.state FROM lumiere_platform.import_review_item item
             JOIN lumiere_platform.import_task_review link
               ON link.organization_id=item.organization_id AND link.company_id=item.company_id AND link.batch_id=item.batch_id
             WHERE item.organization_id=$1::text::numeric AND item.company_id=$2::text::numeric
               AND link.actor_identity=$3 AND link.request_id=$4 AND NOT link.from_inspection
         ), verified AS (
             SELECT DISTINCT item.id FROM items item
             JOIN lumiere_platform.import_run_source_claim claim
               ON claim.organization_id=$1::text::numeric AND claim.company_id=$2::text::numeric
                AND claim.creator_identity=$3 AND claim.task_id=$4 AND claim.item_id=item.id
             JOIN lumiere_platform.import_run_chunk chunk ON chunk.run_id=claim.run_id AND item.id=ANY(chunk.verified_item_ids)
             WHERE item.state<>'excluded' AND EXISTS(SELECT 1 FROM jsonb_array_elements(chunk.source_rows) AS source
                          WHERE source->>'itemId'=item.id::text AND source->>'revision'=item.revision::text)
         ) SELECT (SELECT count(*) FROM items) AS total,(SELECT count(*) FROM verified) AS verified,
                  (SELECT count(*) FROM items WHERE state='excluded') AS excluded",
        &[&org,&company,&scope.actor,&task],
    ).await.map_err(ApiError::internal)?;
    let total: i64 = row.get("total");
    let verified: i64 = row.get("verified");
    let excluded: i64 = row.get("excluded");
    Ok(json!({
        "runs": result,
        "more": more,
        "coverage": {
            "reviewRowCount": total,
            "verifiedRowCount": verified,
            "excludedRowCount": excluded,
            "complete": verified > 0 && total == verified + excluded
        }
    }))
}

async fn run_view(
    client: &tokio_postgres::Client,
    run: Row,
    detail: bool,
) -> Result<Value, ApiError> {
    let id: String = run.get("id");
    let chunks = client.query("SELECT id,ordinal,status,attempts,jsonb_array_length(source_rows) AS rows,
           CASE WHEN $2::bool THEN receipt ELSE NULL END AS receipt,receipt IS NULL AS no_proof,
           cardinality(verified_item_ids) AS verified,COALESCE((receipt->>'failedRows')::int,0) AS failed,
           COALESCE((receipt->>'heldRows')::int,0) AS held,last_error
         FROM lumiere_platform.import_run_chunk WHERE run_id=$1 ORDER BY ordinal",
         &[&id,&detail]).await.map_err(ApiError::internal)?;
    let sum = |column| chunks.iter().map(|r| r.get::<_, i32>(column)).sum::<i32>();
    let (rows, verified, failed, held) = (sum("rows"), sum("verified"), sum("failed"), sum("held"));
    let any = |state| chunks.iter().any(|r| r.get::<_, String>("status") == state);
    let uncertain = chunks
        .iter()
        .any(|r| r.get::<_, String>("status") == "blocked" && r.get::<_, bool>("no_proof"));
    let status = if any("running") {
        "running"
    } else if uncertain || run.get::<_, bool>("dependency_blocked") {
        "blocked"
    } else if any("queued") {
        "queued"
    } else if rows > 0 && rows == verified {
        "verified"
    } else if verified > 0 {
        "partial"
    } else if failed > 0 {
        "failed"
    } else {
        "blocked"
    };
    let checkpoints = chunks.iter().map(|r|json!({"id":r.get::<_,String>("id"),"ordinal":r.get::<_,i32>("ordinal"),
        "status":r.get::<_,String>("status"),"attempts":r.get::<_,i32>("attempts"),"rowCount":r.get::<_,i32>("rows"),
        "receipt":r.get::<_,Option<Value>>("receipt"),"error":r.get::<_,Option<String>>("last_error")})).collect::<Vec<_>>();
    let stamp: String = run.get("created_at");
    Ok(
        json!({"id":id,"taskId":run.get::<_,String>("task_id"),"adapter":run.get::<_,String>("adapter"),
       "actor":run.get::<_,String>("approved_by"),"status":status,"createdAt":stamp,"approvedAt":stamp,
       "rowCount":rows,"verifiedRowCount":verified,"failedRows":failed,"heldRows":held,"chunks":checkpoints}),
    )
}
