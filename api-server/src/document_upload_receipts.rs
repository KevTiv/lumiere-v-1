//! Durable upload receipts reuse the private blob store; no browser value proves a save.
use super::*;
use serde_json::Value;

fn require_receipt_fields(access: &stdb_auth::FieldAccessContext) -> Result<(), ApiError> {
    let documents = [
        "id",
        "organization_id",
        "company_id",
        "owner_id",
        "is_deleted",
        "name",
        "description",
        "file_name",
        "file_size",
        "mimetype",
        "url",
        "checksum",
        "folder_id",
        "res_model",
        "res_id",
        "partner_id",
        "tag_ids",
        "is_favorite",
        "classification_id",
        "retention_days",
        "fiscal_kind",
        "residency_region",
        "metadata",
    ];
    let versions = [
        "id",
        "organization_id",
        "document_id",
        "version_number",
        "file_name",
        "file_size",
        "mimetype",
        "url",
        "checksum",
        "metadata",
        "created_by",
    ];
    if documents.iter().any(|field| {
        !stdb_auth::has_resource_field_read_permission(Some(access), "documents", field)
    }) || versions.iter().any(|field| {
        !stdb_auth::has_resource_field_read_permission(Some(access), "document-versions", field)
    }) {
        return Err(ApiError::Forbidden(
            "the document submission requires access to its registration and version fields".into(),
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct UploadRegistration {
    name: String,
    description: Option<String>,
    folder_id: Option<String>,
    res_model: Option<String>,
    res_id: Option<String>,
    partner_id: Option<String>,
    #[serde(default)]
    tag_ids: Vec<String>,
    #[serde(default)]
    is_favorite: bool,
    classification_id: Option<String>,
    retention_days: Option<u32>,
    fiscal_kind: Option<String>,
    residency_region: Option<String>,
}

impl UploadRegistration {
    pub(super) fn validate(&self) -> Result<(), ApiError> {
        let valid_id = |value: &String| {
            value
                .parse::<u64>()
                .is_ok_and(|id| id > 0 && id.to_string() == *value)
        };
        if self.name.trim().is_empty()
            || self.name.len() > 500
            || self
                .description
                .as_ref()
                .is_some_and(|value| value.len() > 8_000)
            || self.tag_ids.len() > 100
            || self.tag_ids.iter().any(|value| !valid_id(value))
            || [
                &self.folder_id,
                &self.res_id,
                &self.partner_id,
                &self.classification_id,
            ]
            .into_iter()
            .flatten()
            .any(|value| !valid_id(value))
            || [&self.res_model, &self.fiscal_kind, &self.residency_region]
                .into_iter()
                .flatten()
                .any(|value| value.len() > 100)
        {
            return Err(ApiError::Unprocessable(
                "invalid document submission details".into(),
            ));
        }
        Ok(())
    }
}

pub(super) fn submission_object_id(
    organization_id: u64,
    company_id: Option<u64>,
    actor: &str,
    submission_id: &str,
) -> Result<String, ApiError> {
    if !company_id.is_some_and(|id| id > 0)
        || submission_id.len() != 32
        || !submission_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(ApiError::Unprocessable(
            "invalid company or document submission ID".into(),
        ));
    }
    let identity = stdb_auth::identity_sql_literal(actor).map_err(ApiError::Forbidden)?;
    let key = format!(
        "document-submission-v1:{organization_id}:{}:{identity}:{submission_id}",
        company_id.unwrap_or_default()
    );
    Ok(hex::encode(Sha256::digest(key.as_bytes()))[..32].to_string())
}

pub(super) async fn reserve(
    store: &DocumentBlobStoreConfig,
    key: &str,
    proposed: BlobMeta,
) -> Result<BlobMeta, ApiError> {
    if proposed.submission_id.is_none() {
        create_meta(store, key, &proposed).await?;
        return Ok(proposed);
    }
    // Completion can expand the winner's metadata beyond the proposed JSON's
    // byte length, and the create-only reply itself can be lost. Resolve either
    // case through the bounded metadata reader, then verify all immutable request
    // fields. An unproven reservation retains the write/read failure.
    let reservation_error = create_meta(store, key, &proposed).await.err();
    let saved = read_meta(store, key)
        .await
        .map_err(|read_error| reservation_error.unwrap_or(read_error))?;
    if saved.submission_id != proposed.submission_id
        || saved.organization_id != proposed.organization_id
        || saved.company_id != proposed.company_id
        || saved.created_by != proposed.created_by
        || saved.object_key != proposed.object_key
        || saved.file_name != proposed.file_name
        || saved.content_type != proposed.content_type
        || saved.expected_size != proposed.expected_size
        || saved.expected_checksum != proposed.expected_checksum
        || saved.registration != proposed.registration
        || saved.purpose != proposed.purpose
    {
        return Err(ApiError::Conflict(
            "this submission already belongs to different file bytes or document details".into(),
        ));
    }
    Ok(saved)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct ReceiptQuery {
    company_id: u64,
    submission_id: String,
    residency: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UploadReceipt {
    submission_id: String,
    object_key: String,
    url: String,
    file_name: String,
    file_size: String,
    mimetype: String,
    checksum: String,
    file_saved: bool,
    bytes_uploaded: bool,
    registration: UploadRegistration,
    registration_state: &'static str,
    document_id: Option<String>,
    indexing: &'static str,
}

pub(super) async fn receipt(
    State(state): State<Arc<AppState>>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
    Query(query): Query<ReceiptQuery>,
) -> Result<Json<UploadReceipt>, ApiError> {
    let object_id = submission_object_id(
        organization_id,
        Some(query.company_id),
        &session.identity_hex,
        &query.submission_id,
    )?;
    let residency = residency_segment(query.residency.as_deref());
    let object_key = format!("org-{organization_id}/{residency}/{object_id}");
    let (bin_key, meta_key) = object_keys(organization_id, &object_id, &residency);
    let store = &state.config.document_blob_store;
    let meta = read_meta(store, &meta_key).await?;
    require_blob_upload(&state, &session, &meta, &object_key).await?;
    if meta.submission_id.as_deref() != Some(&query.submission_id)
        || meta.company_id != Some(query.company_id)
        || meta.purpose != BlobPurpose::Document
    {
        return Err(ApiError::NotFound("document submission not found".into()));
    }
    let registration = meta
        .registration
        .clone()
        .ok_or_else(|| ApiError::Conflict("document submission details are unavailable".into()))?;
    let url = format!("/api/documents/blobs/object/{organization_id}/{residency}/{object_id}");
    let trusted = TrustedOperationContext::for_resource_read(&state, &session)?;
    let access = Some(trusted.field_access());
    require_receipt_fields(trusted.field_access())?;
    let actor =
        stdb_auth::identity_sql_literal(trusted.actor_identity()).map_err(ApiError::Internal)?;
    let receipt_id = format!(
        "{organization_id}:{}:document:{}",
        query.company_id, query.submission_id
    );
    // This private table is read only through its exact actor/company/model key.
    // It survives document deletion and purge, unlike the version snapshots.
    let canonical = state.stdb.query_sql(&format!(
        "SELECT id, organization_id, company_id, model, operation_key, payload_hash, record_id, created_by FROM record_creation_receipt WHERE id = '{receipt_id}' AND organization_id = {organization_id} AND company_id = {} AND model = 'document' AND created_by = {actor}", query.company_id,
    )).await.map_err(ApiError::internal)?;
    if canonical.len() > 1 {
        return Err(ApiError::Conflict(
            "the document submission receipt is ambiguous".into(),
        ));
    }
    let canonical_id = canonical
        .first()
        .map(|row| {
            let text = |camel: &str, snake: &str| {
                row.get(camel)
                    .or_else(|| row.get(snake))
                    .and_then(Value::as_str)
            };
            if text("id", "id") != Some(receipt_id.as_str())
                || crate::query_exec::row_u64(row, "organizationId", "organization_id")
                    .ok()
                    .flatten()
                    != Some(organization_id)
                || crate::query_exec::row_u64(row, "companyId", "company_id")
                    .ok()
                    .flatten()
                    != Some(query.company_id)
                || text("model", "model") != Some("document")
                || text("operationKey", "operation_key") != Some(query.submission_id.as_str())
            {
                return Err(ApiError::Conflict(
                    "the document submission receipt scope is invalid".into(),
                ));
            }
            crate::query_exec::row_u64(row, "recordId", "record_id")
                .ok()
                .flatten()
                .filter(|id| *id > 0)
                .ok_or_else(|| {
                    ApiError::Conflict("the document submission identity is unavailable".into())
                })
        })
        .transpose()?;
    let rows = execute_resource_query_for_company(
        trusted.client(),
        "documents",
        organization_id,
        trusted.actor_identity(),
        access,
        Some(query.company_id),
    )
    .await?;
    let versions = execute_resource_query_for_company(
        trusted.client(),
        "document-versions",
        organization_id,
        trusted.actor_identity(),
        access,
        Some(query.company_id),
    )
    .await?;
    let checksum = meta
        .actual_checksum
        .clone()
        .or(meta.expected_checksum.clone())
        .ok_or_else(|| ApiError::Conflict("document submission checksum unavailable".into()))?;
    let scope = DocumentBlobScope {
        organization_id,
        company_id: meta.company_id,
        creator_identity: meta.creator_identity(),
        url: &url,
        checksum: &checksum,
    };
    // Resolve the immutable registration snapshot rather than mutable live
    // metadata or the current version's URL. A deleted/hidden parent denies the
    // receipt even though its original version still exists.
    let matching: Vec<_> = versions
        .iter()
        .filter(|version| {
            let submitted = version
                .get("metadata")
                .and_then(Value::as_str)
                .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                .is_some_and(|metadata| {
                    metadata.get("uploadSubmissionId").and_then(Value::as_str)
                        == Some(query.submission_id.as_str())
                });
            submitted
                && crate::query_exec::row_u64(version, "versionNumber", "version_number")
                    .ok()
                    .flatten()
                    == Some(1)
                && version.get("url").and_then(Value::as_str) == Some(url.as_str())
                && version.get("checksum").and_then(Value::as_str) == Some(checksum.as_str())
        })
        .collect();
    if matching.len() > 1 {
        return Err(ApiError::Conflict(
            "multiple documents match this submission; review them before continuing".into(),
        ));
    }
    let document_id = matching
        .first()
        .map(|version| {
            let id = crate::query_exec::row_u64(version, "documentId", "document_id")
                .ok()
                .flatten()
                .ok_or_else(|| {
                    ApiError::Conflict("the document submission identity is unavailable".into())
                })?;
            if canonical_id != Some(id) {
                return Err(ApiError::Conflict(
                    "the document submission has no matching canonical save receipt".into(),
                ));
            }
            if !document_blob_is_visible(&scope, access, &rows, std::slice::from_ref(*version)) {
                return Err(ApiError::Forbidden(
                    "the document submission is no longer accessible".into(),
                ));
            }
            Ok(id.to_string())
        })
        .transpose()?;
    if canonical_id.is_some() && document_id.is_none() {
        return Err(ApiError::Gone("this document submission was already saved; its record or original version is no longer available".into()));
    }

    // Resolve current permission rules after every source read. Frozen upload
    // choices must not disclose fields removed while the request was running.
    // A field mask or incomplete read must never certify absence. Retrying the
    // canonical reducer is safe, but the UI must not call it a new registration.
    let registration_state = if document_id.is_some() {
        "registered"
    } else {
        "unconfirmed"
    };
    let still_current = canonical_id.is_some_and(|id| {
        rows.iter().any(|row| {
            crate::query_exec::row_u64(row, "id", "id").ok().flatten() == Some(id)
                && row.get("url").and_then(Value::as_str) == Some(url.as_str())
                && row.get("checksum").and_then(Value::as_str) == Some(checksum.as_str())
        })
    });
    let indexing = if document_id.is_some() && !still_current {
        "superseded"
    } else if document_id.is_some() {
        indexing_status(
            store,
            &object_key,
            document_id.as_deref().unwrap_or_default(),
            &checksum,
            trusted.client(),
            organization_id,
            query.company_id,
        )
        .await?
    } else {
        "pending"
    };
    let bytes_uploaded = storage::size(store, &bin_key).await?.is_some();
    let current_access = crate::session::load_field_access_context(
        &state.stdb,
        &session.identity_hex,
        organization_id,
    )
    .await
    .map_err(ApiError::Internal)?
    .ok_or(ApiError::Unauthorized)?;
    require_receipt_fields(&current_access)?;
    let current_session = ApiSession {
        field_access: Some(current_access),
        ..session
    };
    require_blob_upload(&state, &current_session, &meta, &object_key).await?;
    trusted.require_current_placement(&state.organization_placements)?;
    Ok(Json(UploadReceipt {
        submission_id: query.submission_id,
        object_key,
        url,
        file_name: meta.file_name,
        file_size: meta.expected_size.to_string(),
        mimetype: meta.content_type,
        checksum,
        file_saved: meta.completed,
        bytes_uploaded,
        registration,
        registration_state,
        document_id,
        indexing,
    }))
}

fn indexing_key(
    object_key: &str,
    document_id: &str,
    checksum: &str,
    outcome: &str,
) -> Result<String, ApiError> {
    let (organization_id, _, _) = parse_object_key(object_key)?;
    let digest = hex::encode(Sha256::digest(
        format!("{object_key}:{document_id}:{checksum}:{outcome}").as_bytes(),
    ));
    Ok(format!(
        "org-{organization_id}/upload-receipts/{}.meta.json",
        &digest[..32]
    ))
}

/// Called only after the ingestion owner has authorized the exact document/blob.
/// A queue acceptance is durable; it is not proof the embedding worker finished.
pub(crate) async fn record_indexing_receipt(
    store: &DocumentBlobStoreConfig,
    object_key: &str,
    document_id: u64,
    checksum: &str,
    queued: bool,
) -> Result<(), ApiError> {
    let outcome = if queued { "queued" } else { "failed" };
    let key = indexing_key(object_key, &document_id.to_string(), checksum, outcome)?;
    storage::put_immutable(store, &key, outcome.as_bytes(), "text/plain").await
}

async fn indexing_status(
    store: &DocumentBlobStoreConfig,
    object_key: &str,
    document_id: &str,
    checksum: &str,
    client: &stdb_client::StdbClient,
    organization_id: u64,
    company_id: u64,
) -> Result<&'static str, ApiError> {
    for status in ["queued", "failed"] {
        if storage::read(
            store,
            &indexing_key(object_key, document_id, checksum, status)?,
            16,
        )
        .await?
        .is_some()
        {
            if status == "queued" {
                return Ok(read_worker_status(
                    store,
                    object_key,
                    document_id,
                    checksum,
                    client,
                    organization_id,
                    company_id,
                )
                .await
                .unwrap_or("unavailable"));
            }
            return Ok(status);
        }
    }
    Ok("pending")
}

/// A manifest records exact admitted effects, not worker success. It contains
/// no source text and is private under the already-authorized upload receipt.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct IndexingJobRef {
    pub job_id: u64,
    pub passage_id: u64,
    pub fingerprint: String,
}

pub(crate) async fn record_indexing_manifest(
    store: &DocumentBlobStoreConfig,
    object_key: &str,
    document_id: u64,
    checksum: &str,
    jobs: &[IndexingJobRef],
) -> Result<(), ApiError> {
    validate_job_refs(jobs)?;
    let key = indexing_key(object_key, &document_id.to_string(), checksum, "jobs-v1")?;
    let bytes = serde_json::to_vec(jobs).map_err(ApiError::internal)?;
    storage::put_immutable(store, &key, &bytes, "application/json").await
}

fn validate_job_refs(jobs: &[IndexingJobRef]) -> Result<(), ApiError> {
    let mut ids = std::collections::HashSet::new();
    let mut passages = std::collections::HashSet::new();
    if jobs.is_empty()
        || jobs.len() > 64
        || jobs.iter().any(|job| {
            job.job_id == 0
                || job.passage_id == 0
                || !ids.insert(job.job_id)
                || !passages.insert(job.passage_id)
                || job.fingerprint.len() != 64
                || !job
                    .fingerprint
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
    {
        return Err(ApiError::Conflict(
            "document indexing manifest is invalid".into(),
        ));
    }
    Ok(())
}

async fn read_worker_status(
    store: &DocumentBlobStoreConfig,
    object_key: &str,
    document_id: &str,
    checksum: &str,
    client: &stdb_client::StdbClient,
    organization_id: u64,
    company_id: u64,
) -> Result<&'static str, ApiError> {
    let key = indexing_key(object_key, document_id, checksum, "jobs-v1")?;
    let Some(bytes) = storage::read(store, &key, 32768).await? else {
        // Legacy queue receipts have no exact expected-job set. They never
        // become complete through newest-row or document-name discovery.
        return Ok("queued");
    };
    let jobs: Vec<IndexingJobRef> = serde_json::from_slice(&bytes).map_err(ApiError::internal)?;
    validate_job_refs(&jobs)?;
    let mut statuses = Vec::with_capacity(jobs.len());
    for job in jobs {
        let rows = client.query_sql(&format!(
            "SELECT id, status, semantic_key FROM queue_job WHERE organization_id = {organization_id} AND company_id = {company_id} AND id = {} AND queue_name = 'embedding' LIMIT 2", job.job_id
        )).await.map_err(ApiError::internal)?;
        let embeddings = client.query_sql(&format!(
            "SELECT expected_fingerprint, index_generation, sync_status FROM search_embedding WHERE organization_id = {organization_id} AND company_id = {company_id} AND content_type = 'ai_evidence_passage' AND content_id = {} LIMIT 2", job.passage_id
        )).await.map_err(ApiError::internal)?;
        statuses.push(worker_status(&job, &rows, &embeddings));
    }
    Ok(combine_worker_statuses(&statuses))
}

fn worker_status(job: &IndexingJobRef, rows: &[Value], embeddings: &[Value]) -> &'static str {
    if rows.len() != 1 || embeddings.len() != 1 {
        return "unavailable";
    }
    let text = |row: &Value, camel: &str, snake: &str| {
        row.get(camel)
            .or_else(|| row.get(snake))
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    let semantic_key = format!(
        "embedding:ai_evidence_passage:{}:{}:semantic-index-v1",
        job.passage_id, job.fingerprint
    );
    if text(&rows[0], "semanticKey", "semantic_key").as_deref() != Some(&semantic_key)
        || text(
            &embeddings[0],
            "expectedFingerprint",
            "expected_fingerprint",
        )
        .as_deref()
            != Some(&job.fingerprint)
        || text(&embeddings[0], "indexGeneration", "index_generation").as_deref()
            != Some("semantic-index-v1")
    {
        return "unavailable";
    }
    match (
        text(&rows[0], "status", "status").as_deref(),
        text(&embeddings[0], "syncStatus", "sync_status").as_deref(),
    ) {
        (Some("Completed"), Some("synced")) => "completed",
        (Some("DeadLettered" | "Cancelled"), _) | (_, Some("failed")) => "failed",
        (Some("Leased"), Some("pending")) => "running",
        (Some("Pending"), Some("pending")) => "queued",
        _ => "unavailable",
    }
}

fn combine_worker_statuses(statuses: &[&str]) -> &'static str {
    if statuses.is_empty() || statuses.contains(&"unavailable") {
        "unavailable"
    } else if statuses.contains(&"failed") {
        "failed"
    } else if statuses.contains(&"running") {
        "running"
    } else if statuses.iter().all(|status| *status == "completed") {
        "completed"
    } else {
        "queued"
    }
}

#[cfg(test)]
mod worker_status_tests {
    use super::*;
    fn fixture() -> (IndexingJobRef, Vec<Value>, Vec<Value>) {
        let job = IndexingJobRef {
            job_id: 10,
            passage_id: 20,
            fingerprint: "a".repeat(64),
        };
        let rows = vec![
            serde_json::json!({"id":10,"semanticKey":format!("embedding:ai_evidence_passage:20:{}:semantic-index-v1",job.fingerprint),"status":"Completed"}),
        ];
        let embeddings = vec![
            serde_json::json!({"expectedFingerprint":job.fingerprint,"indexGeneration":"semantic-index-v1","syncStatus":"synced"}),
        ];
        (job, rows, embeddings)
    }
    #[test]
    fn completed_requires_both_canonical_finalization_records() {
        let (job, mut rows, mut embeddings) = fixture();
        assert_eq!(worker_status(&job, &rows, &embeddings), "completed");
        rows[0]["status"] = Value::String("Leased".into());
        assert_eq!(worker_status(&job, &rows, &embeddings), "unavailable");
        embeddings[0]["syncStatus"] = Value::String("pending".into());
        assert_eq!(worker_status(&job, &rows, &embeddings), "running");
        rows[0]["status"] = Value::String("Pending".into());
        assert_eq!(worker_status(&job, &rows, &embeddings), "queued");
        rows[0]["status"] = Value::String("DeadLettered".into());
        assert_eq!(worker_status(&job, &rows, &embeddings), "failed");
    }
    #[test]
    fn stale_fingerprints_and_ambiguous_or_missing_rows_never_complete() {
        let (job, rows, mut embeddings) = fixture();
        assert_eq!(worker_status(&job, &[], &embeddings), "unavailable");
        assert_eq!(
            worker_status(&job, &[rows[0].clone(), rows[0].clone()], &embeddings),
            "unavailable"
        );
        embeddings[0]["expectedFingerprint"] = Value::String("b".repeat(64));
        assert_eq!(worker_status(&job, &rows, &embeddings), "unavailable");
    }
    #[test]
    fn partial_passage_sets_do_not_report_completed() {
        assert_eq!(combine_worker_statuses(&[]), "unavailable");
        assert_eq!(combine_worker_statuses(&["completed", "queued"]), "queued");
        assert_eq!(combine_worker_statuses(&["completed", "failed"]), "failed");
        assert_eq!(
            combine_worker_statuses(&["completed", "unavailable"]),
            "unavailable"
        );
        assert_eq!(
            combine_worker_statuses(&["completed", "completed"]),
            "completed"
        );
    }
    #[test]
    fn manifest_requires_unique_exact_job_and_passage_identity() {
        let (job, _, _) = fixture();
        assert!(validate_job_refs(&[job.clone()]).is_ok());
        assert!(validate_job_refs(&[job.clone(), job.clone()]).is_err());
        assert!(validate_job_refs(&[]).is_err());
        assert!(validate_job_refs(&[IndexingJobRef {
            fingerprint: "not-a-hash".into(),
            ..job
        }])
        .is_err());
    }
}
