use super::{read_task, valid_request_id, StorageScope};
use crate::{
    cold_tier::pg_pool,
    error::ApiError,
    query_exec::{read_spreadsheet_document_rows, resolve_membership_company_id},
    session::load_field_access_context,
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::OrgSession,
};
use axum::{
    extract::{Path, Query, State},
    Json,
};
use futures_util::{stream, StreamExt, TryStreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

use super::super::{full_administrator, task_company_scope};

type Pool = deadpool_postgres::Pool;

pub(super) async fn creator_for(
    pool: &Pool,
    scope: StorageScope<'_>,
    request: &str,
    admin: bool,
) -> Result<String, ApiError> {
    if !valid_request_id(request) {
        return Err(ApiError::BadRequest(
            "invalid import request identity".into(),
        ));
    }
    if admin {
        let client = pool.get().await.map_err(ApiError::internal)?;
        let row = client
            .query_opt(
                "SELECT actor_identity FROM lumiere_platform.import_task_handoff
             WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric
               AND recipient_identity=$3 AND request_id=$4",
                &[
                    &scope.organization.to_string(),
                    &scope.company.to_string(),
                    &scope.actor,
                    &request,
                ],
            )
            .await
            .map_err(ApiError::internal)?;
        if let Some(row) = row {
            return Ok(row.get("actor_identity"));
        }
    }
    Ok(scope.actor.to_owned())
}

pub(super) async fn find_incoming_document_task(
    pool: &Pool,
    viewer: StorageScope<'_>,
    context: &TrustedOperationContext,
    document: u64,
    version: u64,
    checksum: &str,
    require_current: bool,
) -> Result<Option<String>, ApiError> {
    let (_, conversation) =
        super::managed_source::document_task_identity(viewer.company, document, version);
    let client = pool.get().await.map_err(ApiError::internal)?;
    let row = client.query_opt(
        "SELECT task.request_id,task.actor_identity FROM lumiere_platform.import_task_handoff grant_row
         JOIN lumiere_platform.import_task task USING (organization_id,company_id,actor_identity,request_id)
         JOIN lumiere_platform.import_task_source source USING (organization_id,company_id,actor_identity,request_id)
         WHERE grant_row.organization_id=$1::text::numeric AND grant_row.company_id=$2::text::numeric
           AND grant_row.recipient_identity=$3 AND source.ordinal=0 AND source.source_sha256=$4
           AND task.conversation_key=$5
         ORDER BY task.created_at DESC, task.request_id DESC LIMIT 1",
        &[&viewer.organization.to_string(), &viewer.company.to_string(), &viewer.actor, &checksum, &conversation],
    ).await.map_err(ApiError::internal)?;
    if require_current {
        if let Some(row) = &row {
            let creator: String = row.get("actor_identity");
            let owner = stdb_auth::identity_sql_literal(&creator).map_err(ApiError::Internal)?;
            let org = viewer.organization;
            let company = viewer.company;
            let matches = context.client().query_sql(&format!(
                "SELECT id FROM document WHERE organization_id={org} AND company_id={company}
                   AND id={document} AND owner_id={owner} AND current_version_id={version} AND is_deleted=false"
            )).await.map_err(ApiError::internal)?;
            if matches.len() != 1 {
                return Err(ApiError::Conflict(
                    "the selected document version changed".into(),
                ));
            }
        }
    }
    Ok(row.map(|row| row.get("request_id")))
}

pub(super) async fn require_document_access(
    context: &TrustedOperationContext,
    company: u64,
    creator: &str,
    task: &Value,
    required: bool,
) -> Result<(), ApiError> {
    let selection = task["preparation"]["files"]
        .as_array()
        .and_then(|files| files.iter().find_map(|file| file.get("managedSelection")));
    let reference = task.get("managedDocument").or(selection);
    let Some(reference) = reference else {
        return if required {
            Err(ApiError::Forbidden(
                "a managed document is required for intake access".into(),
            ))
        } else {
            Ok(())
        };
    };
    let get_id = |key: &str| {
        reference[key]
            .as_str()
            .and_then(|id| id.parse::<u64>().ok())
            .filter(|id| *id > 0)
            .ok_or_else(|| ApiError::NotFound("import source version is unavailable".into()))
    };
    let document_id = get_id("documentId")?;
    let version_id = get_id("versionId")?;
    let checksum = task["files"][0]["sha256"]
        .as_str()
        .ok_or_else(|| ApiError::NotFound("import source version is unavailable".into()))?;
    let matching = if creator == context.actor_identity() {
        let (_, version) =
            read_spreadsheet_document_rows(context, Some(company), document_id, Some(version_id))
                .await?;
        version.as_ref().and_then(|row| row["checksum"].as_str()) == Some(checksum)
    } else {
        let access = Some(context.field_access());
        if !["documents", "document-versions"]
            .iter()
            .all(|resource| stdb_auth::has_resource_read_permission(access, resource))
            || !stdb_auth::has_resource_field_read_permission(
                access,
                "document-versions",
                "checksum",
            )
        {
            return Err(ApiError::Forbidden(
                "source document read access is required".into(),
            ));
        }
        let org = context.organization_id();
        let owner = stdb_auth::identity_sql_literal(creator).map_err(ApiError::Internal)?;
        // The grant authorizes the saved copy only. Keep ordinary document listing
        // and spreadsheet access owner-scoped.
        let documents = context
            .client()
            .query_sql(&format!(
                "SELECT id FROM document WHERE organization_id={org} AND company_id={company}
                AND id={document_id} AND owner_id={owner} AND is_deleted=false"
            ))
            .await
            .map_err(ApiError::internal)?;
        let versions = context
            .client()
            .query_sql(&format!(
                "SELECT checksum FROM document_version WHERE organization_id={org}
                AND document_id={document_id} AND id={version_id} AND created_by={owner}"
            ))
            .await
            .map_err(ApiError::internal)?;
        documents.len() == 1
            && matches!(versions.as_slice(), [row] if row["checksum"].as_str() == Some(checksum))
    };
    if !matching {
        return Err(ApiError::NotFound(
            "import source version is unavailable".into(),
        ));
    }
    Ok(())
}

pub(in crate::routes::import_reviews) async fn read_for(
    pool: &Pool,
    context: &TrustedOperationContext,
    viewer: StorageScope<'_>,
    request: &str,
) -> Result<(String, Value), ApiError> {
    let admin = full_administrator(context.field_access());
    let creator = creator_for(pool, viewer, request, admin).await?;
    let mut task = read_task(
        pool,
        StorageScope {
            actor: &creator,
            ..viewer
        },
        request,
    )
    .await?;
    let is_creator = creator == viewer.actor;
    if !admin || !is_creator {
        require_document_access(context, viewer.company, &creator, &task, !admin).await?;
    }
    let client = pool.get().await.map_err(ApiError::internal)?;
    let row = client
        .query_opt(
            "SELECT recipient_identity,revision FROM lumiere_platform.import_task_handoff
         WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric
           AND actor_identity=$3 AND request_id=$4",
            &[
                &viewer.organization.to_string(),
                &viewer.company.to_string(),
                &creator,
                &request,
            ],
        )
        .await
        .map_err(ApiError::internal)?;
    let recipient: Option<String> = row.as_ref().and_then(|row| row.get("recipient_identity"));
    if !is_creator && recipient.as_deref() != Some(viewer.actor) {
        return Err(ApiError::NotFound("import task not found".into()));
    }
    if !is_creator {
        if let Some(files) = task["files"].as_array_mut() {
            for file in files {
                if let Some(file) = file.as_object_mut() {
                    file.remove("previousMatch");
                }
            }
        }
    }
    task["handoff"] = json!({
        "creator": creator,
        "recipient": recipient,
        "revision": row.as_ref().map_or(0, |row| row.get::<_, i32>("revision")),
        "canManage": is_creator,
        "canReview": admin,
    });
    Ok((creator, task))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct HandoffQuery {
    company_id: u64,
}

pub(super) async fn recipients(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(request): Path<String>,
    Query(query): Query<HandoffQuery>,
) -> Result<Json<Value>, ApiError> {
    let context = task_company_scope(&state, &session, query.company_id).await?;
    if !valid_request_id(&request) {
        return Err(ApiError::BadRequest(
            "invalid import request identity".into(),
        ));
    }
    let org = context.organization_id();
    let scope = StorageScope {
        organization: org,
        company: query.company_id,
        actor: context.actor_identity(),
    };
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let task = read_task(&pool, scope, &request).await?;
    require_document_access(
        &context,
        scope.company,
        scope.actor,
        &task,
        !full_administrator(context.field_access()),
    )
    .await?;
    // Publish only eligible display names and stable IDs. This task-specific
    // roster never opens the general administration user directory.
    let profiles = context
        .client()
        .query_sql(&format!(
            "SELECT identity,name FROM user_profile WHERE organization_id={org} AND is_active=true"
        ))
        .await
        .map_err(ApiError::internal)?;
    let mut candidates = std::collections::BTreeMap::new();
    for profile in profiles {
        let Some(identity) = crate::auth_password::identity_cell_to_hex(&profile["identity"])
        else {
            continue;
        };
        let Some(name) = profile["name"]
            .as_str()
            .map(str::trim)
            .filter(|name| !name.is_empty())
        else {
            continue;
        };
        if identity != scope.actor {
            candidates
                .entry(identity)
                .and_modify(|name: &mut Option<String>| *name = None)
                .or_insert(Some(name.to_owned()));
        }
    }
    let context = &context;
    let mut people: Vec<(String, String)> = stream::iter(
        candidates
            .into_iter()
            .filter_map(|(id, name)| Some((id, name?))),
    )
    .map(|(id, name)| async move {
        if recipient_allowed(context, scope, &id).await? {
            Ok::<_, ApiError>(Some((id, name)))
        } else {
            Ok(None)
        }
    })
    .buffer_unordered(8)
    .try_filter_map(|candidate| async move { Ok(candidate) })
    .try_collect()
    .await?;
    people.sort_by(|(left_id, left), (right_id, right)| {
        left.cmp(right).then_with(|| left_id.cmp(right_id))
    });
    let mut counts = std::collections::BTreeMap::new();
    for (_, name) in &people {
        *counts.entry(name.clone()).or_insert(0usize) += 1;
    }
    let people = people
        .into_iter()
        .map(|(identity, name)| {
            let label = if counts.get(&name) == Some(&1) {
                name
            } else {
                format!("{name} (…{})", &identity[identity.len() - 8..])
            };
            json!({"value":identity,"label":label})
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({"recipients": people})))
}

async fn recipient_allowed(
    context: &TrustedOperationContext,
    scope: StorageScope<'_>,
    identity: &str,
) -> Result<bool, ApiError> {
    let access = load_field_access_context(context.client(), identity, scope.organization)
        .await
        .map_err(ApiError::Internal)?;
    if !access.as_ref().is_some_and(full_administrator) {
        return Ok(false);
    }
    match resolve_membership_company_id(
        context.client(),
        scope.organization,
        identity,
        Some(scope.company),
        "handoff recipient is outside this company",
    )
    .await
    {
        Ok(company) => Ok(company == scope.company),
        Err(ApiError::Forbidden(_) | ApiError::NotFound(_)) => Ok(false),
        Err(error) => Err(error),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct HandoffBody {
    pub(super) company_id: u64,
    pub(super) recipient: Option<String>,
    pub(super) expected_revision: i32,
}

pub(super) async fn update(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(request): Path<String>,
    Json(body): Json<HandoffBody>,
) -> Result<Json<Value>, ApiError> {
    let context = task_company_scope(&state, &session, body.company_id).await?;
    let scope = StorageScope {
        organization: context.organization_id(),
        company: body.company_id,
        actor: context.actor_identity(),
    };
    if !valid_request_id(&request) || !(0..i32::MAX).contains(&body.expected_revision) {
        return Err(ApiError::BadRequest(
            "invalid import handoff identity or revision".into(),
        ));
    }
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let task = read_task(&pool, scope, &request).await?;
    require_document_access(
        &context,
        scope.company,
        scope.actor,
        &task,
        !full_administrator(context.field_access()),
    )
    .await?;
    if let Some(recipient) = body.recipient.as_deref() {
        if recipient == scope.actor
            || recipient.len() != 64
            || !recipient
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(ApiError::BadRequest("invalid handoff recipient".into()));
        }
        if !recipient_allowed(&context, scope, recipient).await? {
            return Err(ApiError::Forbidden(
                "recipient lacks company source review authority".into(),
            ));
        }
    }
    save(&pool, scope, &request, body).await.map(Json)
}

pub(super) async fn save(
    pool: &Pool,
    scope: StorageScope<'_>,
    request: &str,
    body: HandoffBody,
) -> Result<Value, ApiError> {
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    let org = scope.organization.to_string();
    let company = scope.company.to_string();
    let keys: &[&(dyn tokio_postgres::types::ToSql + Sync)] =
        &[&org, &company, &scope.actor, &request];
    tx.query_opt(
        "SELECT request_id FROM lumiere_platform.import_task WHERE organization_id=$1::text::numeric
          AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4 FOR UPDATE",
        keys,
    ).await.map_err(ApiError::internal)?.ok_or_else(|| ApiError::NotFound("import task not found".into()))?;
    let row = tx.query_opt(
        "SELECT recipient_identity,revision FROM lumiere_platform.import_task_handoff WHERE organization_id=$1::text::numeric
          AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4",
        keys,
    ).await.map_err(ApiError::internal)?;
    let current: Option<String> = row.as_ref().and_then(|row| row.get("recipient_identity"));
    let revision = row.map_or(0, |row| row.get::<_, i32>("revision"));
    let desired = body.recipient;
    if revision != body.expected_revision
        && !(desired == current && revision == body.expected_revision + 1)
    {
        return Err(ApiError::Conflict(
            "the import handoff changed; refresh before continuing".into(),
        ));
    }
    let next = if desired == current {
        revision
    } else {
        revision + 1
    };
    if next != revision {
        if let Some(recipient) = desired.as_deref() {
            let collision = tx.query_opt(
                "SELECT request_id FROM lumiere_platform.import_task WHERE organization_id=$1::text::numeric
                  AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4",
                &[&org, &company, &recipient, &request],
            ).await.map_err(ApiError::internal)?;
            if collision.is_some() {
                return Err(ApiError::Conflict(
                    "recipient already owns this import task identity".into(),
                ));
            }
        }

        tx.execute(
            "INSERT INTO lumiere_platform.import_task_handoff
               (organization_id,company_id,actor_identity,request_id,recipient_identity,revision)
             VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6)
             ON CONFLICT (organization_id,company_id,actor_identity,request_id)
             DO UPDATE SET recipient_identity=excluded.recipient_identity,revision=excluded.revision",
            &[&org,&company,&scope.actor,&request,&desired,&next],
        ).await.map_err(|error| {
            if error.code() == Some(&tokio_postgres::error::SqlState::UNIQUE_VIOLATION) {
                ApiError::Conflict("the recipient already has a handoff for this task identity".into())
            } else { ApiError::internal(error) }
        })?;
    }
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(json!({"recipient": desired, "revision": next}))
}
