//! Review positions do not change source rows or approval state.

use super::{
    handoff, pg_pool, scope, ApiError, AppState, Arc, Json, OrgSession, Path, Query, State,
    StorageScope,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio_postgres::{Row, Transaction};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReadQuery {
    company_id: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SavePosition {
    company_id: u64,
    review_id: String,
    group: String,
    item_id: Option<String>,
    item_revision: Option<i32>,
    expected_revision: i32,
}

fn positive_id(value: &str) -> Option<i64> {
    let id = value.parse::<i64>().ok().filter(|id| *id > 0)?;
    (id.to_string() == value).then_some(id)
}

impl SavePosition {
    fn position(&self) -> Result<(i64, Option<i64>), ApiError> {
        let invalid = || ApiError::BadRequest("Invalid review checkpoint".into());
        let review = positive_id(&self.review_id).ok_or_else(invalid)?;
        let item = self
            .item_id
            .as_deref()
            .map(|id| positive_id(id).ok_or_else(invalid))
            .transpose()?;
        if !(0..i32::MAX).contains(&self.expected_revision)
            || self.group.len() > 512
            || self.group.chars().any(char::is_control)
            || (self.group != "all"
                && !["missing:", "proposal:", "issue:"].iter().any(|prefix| {
                    self.group
                        .strip_prefix(prefix)
                        .is_some_and(|detail| !detail.is_empty())
                }))
            || item.is_some() != self.item_revision.is_some()
            || self.item_revision.is_some_and(|revision| revision < 1)
        {
            return Err(invalid());
        }
        Ok((review, item))
    }
}

fn envelope(scope: StorageScope<'_>, request: &str, row: Option<&Row>) -> Value {
    let checkpoint = row.map(|row| {
        json!({
            "reviewId": row.get::<_, i64>("review_id").to_string(),
            "group": row.get::<_, String>("issue_group"),
            "itemId": row.get::<_, Option<i64>>("item_id").map(|id| id.to_string()),
            "itemRevision": row.get::<_, Option<i32>>("item_revision"),
            "revision": row.get::<_, i32>("revision"),
        })
    });
    let status = match row {
        None => "empty",
        Some(row) if row.get::<_, bool>("is_current") => "saved",
        Some(_) => "stale",
    };
    json!({"organizationId":scope.organization.to_string(),"companyId":scope.company.to_string(),"taskId":request,"status":status,"checkpoint":checkpoint})
}

const READ_POSITION: &str = "SELECT c.review_id,c.issue_group,c.item_id,c.item_revision,c.revision,
    (link.batch_id IS NOT NULL AND CASE WHEN c.item_id IS NULL THEN EXISTS (
        SELECT 1 FROM lumiere_platform.import_review_item pending WHERE pending.organization_id=c.organization_id
            AND pending.company_id=c.company_id AND pending.batch_id=c.review_id AND pending.state='needs_review'
    ) ELSE COALESCE(item.state='needs_review' AND item.revision=c.item_revision,false) END) AS is_current
    FROM lumiere_platform.import_review_checkpoint c
    LEFT JOIN lumiere_platform.import_task_review link ON
        link.organization_id=c.organization_id AND link.company_id=c.company_id
        AND link.actor_identity=c.actor_identity AND link.request_id=c.request_id AND link.batch_id=c.review_id
    LEFT JOIN lumiere_platform.import_review_item item ON
        item.organization_id=c.organization_id AND item.company_id=c.company_id
        AND item.batch_id=c.review_id AND item.id=c.item_id
    WHERE c.organization_id=$1::text::numeric AND c.company_id=$2::text::numeric
        AND c.actor_identity=$3 AND c.request_id=$4";

async fn require_current_recipient(
    tx: &Transaction<'_>,
    viewer: StorageScope<'_>,
    creator: &str,
    request: &str,
) -> Result<(), ApiError> {
    if viewer.actor == creator {
        return Ok(());
    }
    let grant = tx.query_opt("SELECT recipient_identity FROM lumiere_platform.import_task_handoff
        WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4 FOR SHARE",
        &[&viewer.organization.to_string(), &viewer.company.to_string(), &creator, &request])
        .await.map_err(ApiError::internal)?;
    if grant
        .and_then(|row| row.get::<_, Option<String>>(0))
        .as_deref()
        != Some(viewer.actor)
    {
        return Err(ApiError::NotFound("Import task not found".into()));
    }
    Ok(())
}

pub(super) async fn read(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(request): Path<String>,
    Query(query): Query<ReadQuery>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, query.company_id).await?;
    let viewer = StorageScope {
        organization: context.organization_id(),
        company: query.company_id,
        actor: context.actor_identity(),
    };
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let (creator, _) = handoff::read_for(&pool, &context, viewer, &request).await?;
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    require_current_recipient(&tx, viewer, &creator, &request).await?;
    let row = tx
        .query_opt(
            READ_POSITION,
            &[
                &viewer.organization.to_string(),
                &viewer.company.to_string(),
                &creator,
                &request,
            ],
        )
        .await
        .map_err(ApiError::internal)?;
    context.require_current_placement(&state.organization_placements)?;
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(Json(envelope(viewer, &request, row.as_ref())))
}

pub(super) async fn save(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(request): Path<String>,
    Json(body): Json<SavePosition>,
) -> Result<Json<Value>, ApiError> {
    let (review, item) = body.position()?;
    let context = scope(&state, &session, body.company_id).await?;
    let viewer = StorageScope {
        organization: context.organization_id(),
        company: body.company_id,
        actor: context.actor_identity(),
    };
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let (creator, _) = handoff::read_for(&pool, &context, viewer, &request).await?;
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    require_current_recipient(&tx, viewer, &creator, &request).await?;
    let org = viewer.organization.to_string();
    let company = viewer.company.to_string();
    let linked = tx.query_opt("SELECT batch_id FROM lumiere_platform.import_task_review
        WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4 AND batch_id=$5 FOR SHARE",
        &[&org,&company,&creator,&request,&review]).await.map_err(ApiError::internal)?;
    if linked.is_none() {
        return Err(ApiError::NotFound(
            "Review is not available for this import task".into(),
        ));
    }
    let pending = tx
        .query_opt(
            "SELECT id FROM lumiere_platform.import_review_item
        WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND batch_id=$3
        AND state='needs_review' AND ($4::bigint IS NULL OR (id=$4 AND revision=$5))
        ORDER BY id LIMIT 1 FOR SHARE",
            &[&org, &company, &review, &item, &body.item_revision],
        )
        .await
        .map_err(ApiError::internal)?;
    if pending.is_none() {
        return Err(ApiError::Conflict("The review position changed".into()));
    }
    let saved = if body.expected_revision == 0 {
        tx.execute("INSERT INTO lumiere_platform.import_review_checkpoint
            (organization_id,company_id,actor_identity,request_id,review_id,issue_group,item_id,item_revision,updated_by,revision)
            VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6,$7,$8,$9,1) ON CONFLICT DO NOTHING",
            &[&org,&company,&creator,&request,&review,&body.group,&item,&body.item_revision,&viewer.actor])
            .await.map_err(ApiError::internal)?
    } else {
        tx.execute("UPDATE lumiere_platform.import_review_checkpoint SET review_id=$5,issue_group=$6,item_id=$7,
            item_revision=$8,updated_by=$9,revision=revision+1
            WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4 AND revision=$10",
            &[&org,&company,&creator,&request,&review,&body.group,&item,&body.item_revision,&viewer.actor,&body.expected_revision])
            .await.map_err(ApiError::internal)?
    };
    if saved != 1 {
        return Err(ApiError::Conflict(
            "The saved review checkpoint changed".into(),
        ));
    }
    let row = tx
        .query_opt(READ_POSITION, &[&org, &company, &creator, &request])
        .await
        .map_err(ApiError::internal)?;
    context.require_current_placement(&state.organization_placements)?;
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(Json(envelope(viewer, &request, row.as_ref())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_exact_item_revision_pairs() {
        let position = || SavePosition {
            company_id: 6,
            review_id: "42".into(),
            group: "missing:quantity".into(),
            item_id: Some("9007199254740993".into()),
            item_revision: Some(2),
            expected_revision: 0,
        };
        assert_eq!(
            position().position().ok(),
            Some((42, Some(9007199254740993)))
        );
        assert_eq!(positive_id("01"), None);
        assert!(SavePosition {
            item_revision: None,
            ..position()
        }
        .position()
        .is_err());
        assert!(SavePosition {
            expected_revision: -1,
            ..position()
        }
        .position()
        .is_err());
        assert!(SavePosition {
            group: "issue:".into(),
            ..position()
        }
        .position()
        .is_err());
    }
}
