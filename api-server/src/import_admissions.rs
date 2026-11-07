//! Private immutable source receipts. Admission is provenance, never authority.

use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    document_blob_store::{self as storage, DocumentBlobStoreConfig},
    error::ApiError,
    file_extraction::{MAX_WORKBOOK_BYTES, XLSX_POLICY_VERSION},
};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceAdmission {
    organization_id: u64,
    company_id: u64,
    actor: String,
    source_sha256: String,
    source_size: usize,
    dataset_sha256: String,
    format: String,
    policy_version: String,
    content_policy_version: String,
    instruction_trust: String,
}

fn keys(org: u64, id: &str) -> Result<(String, String), ApiError> {
    if org == 0
        || id.len() != 32
        || !id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(ApiError::BadRequest(
            "invalid source admission identity".into(),
        ));
    }
    let base = format!("org-{org}/import-admissions/{id}");
    Ok((format!("{base}.bin"), format!("{base}.meta.json")))
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn record_source_admission(
    store: &DocumentBlobStoreConfig,
    org: u64,
    company: u64,
    actor: &str,
    bytes: &[u8],
    format: &str,
    dataset_sha256: &str,
    policy_version: &str,
) -> Result<String, ApiError> {
    if bytes.is_empty() || bytes.len() > MAX_WORKBOOK_BYTES || org == 0 || company == 0 {
        return Err(ApiError::BadRequest("invalid source admission".into()));
    }
    let mut random = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut random);
    let id = hex::encode(random);
    let (data_key, meta_key) = keys(org, &id)?;
    let receipt = SourceAdmission {
        organization_id: org,
        company_id: company,
        actor: actor.into(),
        source_sha256: hex::encode(Sha256::digest(bytes)),
        source_size: bytes.len(),
        dataset_sha256: dataset_sha256.into(),
        format: format.into(),
        policy_version: policy_version.into(),
        content_policy_version: lumiere_file_inspection::INSPECTION_POLICY_VERSION.into(),
        instruction_trust: "untrusted".into(),
    };
    let metadata = serde_json::to_vec(&receipt).map_err(ApiError::internal)?;
    // Only this metadata makes the source resolvable. A failed second write can
    // leave a private orphan, never an admitted or public file.
    storage::put_immutable(store, &data_key, bytes, "application/octet-stream").await?;
    storage::put_immutable(store, &meta_key, &metadata, "application/json").await?;
    Ok(id)
}

fn validate_scope(
    receipt: &SourceAdmission,
    org: u64,
    company: u64,
    actor: &str,
) -> Result<(), ApiError> {
    if receipt.organization_id != org || receipt.company_id != company || receipt.actor != actor {
        return Err(ApiError::Forbidden(
            "source admission does not belong to this import scope".into(),
        ));
    }
    let expected_policy = match receipt.format.as_str() {
        "csv" => lumiere_file_inspection::INSPECTION_POLICY_VERSION,
        "xlsx" => XLSX_POLICY_VERSION,
        _ => {
            return Err(ApiError::Conflict(
                "source admission format is unsupported".into(),
            ))
        }
    };
    if receipt.policy_version != expected_policy
        || receipt.content_policy_version != lumiere_file_inspection::INSPECTION_POLICY_VERSION
        || receipt.instruction_trust != "untrusted"
        || receipt.source_size == 0
        || receipt.source_size > MAX_WORKBOOK_BYTES
        || ![&receipt.source_sha256, &receipt.dataset_sha256]
            .iter()
            .all(|digest| {
                digest.len() == 64
                    && digest
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            })
    {
        return Err(ApiError::Conflict(
            "source admission policy changed; inspect the source again".into(),
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn verify_import_source(
    store: &DocumentBlobStoreConfig,
    organization_id: u64,
    company_id: u64,
    actor: &str,
    admission_id: &str,
    request_id: &str,
    entity: &str,
    final_content_sha256: &str,
) -> Result<Value, ApiError> {
    let (data_key, meta_key) = keys(organization_id, admission_id)?;
    let metadata = storage::read(store, &meta_key, 4096)
        .await?
        .ok_or_else(|| {
            ApiError::Conflict("source admission is unavailable; inspect again".into())
        })?;
    let receipt: SourceAdmission = serde_json::from_slice(&metadata)
        .map_err(|_| ApiError::Conflict("source admission is invalid".into()))?;
    validate_scope(&receipt, organization_id, company_id, actor)?;
    let bytes = storage::read(store, &data_key, MAX_WORKBOOK_BYTES as u64)
        .await?
        .ok_or_else(|| ApiError::Conflict("admitted source bytes are unavailable".into()))?;
    if bytes.len() != receipt.source_size
        || hex::encode(Sha256::digest(&bytes)) != receipt.source_sha256
    {
        return Err(ApiError::Conflict(
            "admitted source identity changed".into(),
        ));
    }
    let audit = json!({"organizationId":organization_id.to_string(),"companyId":company_id.to_string(),
        "actor":actor,"sourceAdmissionId":admission_id,"sourceSha256":receipt.source_sha256,
        "sourceDatasetSha256":receipt.dataset_sha256,"sourcePolicyVersion":receipt.policy_version,
        "contentPolicyVersion":receipt.content_policy_version,"instructionTrust":"untrusted",
        "derivation":"user_prepared_derivative","finalContentSha256":final_content_sha256,
        "requestId":request_id,"entity":entity});
    let digest = hex::encode(Sha256::digest(format!(
        "import-preparation-v1:{organization_id}:{company_id}:{actor}:{request_id}"
    )));
    let key = format!(
        "org-{organization_id}/import-preparations/{}.meta.json",
        &digest[..32]
    );
    storage::put_immutable(
        store,
        &key,
        &serde_json::to_vec(&audit).map_err(ApiError::internal)?,
        "application/json",
    )
    .await?;
    Ok(audit)
}

/// Read the immutable source-to-submission binding after an exact native import
/// receipt has been authorized. This does not authorize access to file bytes or
/// establish an original row/review revision. `actor` is the importing principal
/// retained by that receipt, not an identity supplied by the history caller.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn read_import_source_binding(
    store: &DocumentBlobStoreConfig,
    organization_id: u64,
    company_id: u64,
    actor: &str,
    request_id: &str,
    entity: &str,
    final_content_sha256: &str,
) -> Result<Option<Value>, ApiError> {
    let hex = |value: &str, length: usize| {
        value.len() == length
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    };
    if organization_id == 0
        || company_id == 0
        || actor.is_empty()
        || !hex(request_id, 32)
        || !hex(final_content_sha256, 64)
    {
        return Err(ApiError::BadRequest(
            "invalid recorded import source identity".into(),
        ));
    }
    let digest = hex::encode(Sha256::digest(format!(
        "import-preparation-v1:{organization_id}:{company_id}:{actor}:{request_id}"
    )));
    let key = format!(
        "org-{organization_id}/import-preparations/{}.meta.json",
        &digest[..32]
    );
    let Some(bytes) = storage::read(store, &key, 4096).await? else {
        return Ok(None);
    };
    let binding: Value = serde_json::from_slice(&bytes)
        .map_err(|_| ApiError::Conflict("recorded import source is invalid".into()))?;
    if binding.get("organizationId").and_then(Value::as_str)
        != Some(organization_id.to_string().as_str())
        || binding.get("companyId").and_then(Value::as_str) != Some(company_id.to_string().as_str())
        || binding.get("actor").and_then(Value::as_str) != Some(actor)
        || binding.get("requestId").and_then(Value::as_str) != Some(request_id)
        || binding.get("entity").and_then(Value::as_str) != Some(entity)
        || binding.get("finalContentSha256").and_then(Value::as_str) != Some(final_content_sha256)
        || binding.get("derivation").and_then(Value::as_str) != Some("user_prepared_derivative")
    {
        return Err(ApiError::Conflict(
            "recorded import source does not match its native receipt".into(),
        ));
    }
    let admission_id = binding
        .get("sourceAdmissionId")
        .and_then(Value::as_str)
        .filter(|value| hex(value, 32))
        .ok_or_else(|| ApiError::Conflict("recorded source admission is invalid".into()))?;
    let (_, metadata_key) = keys(organization_id, admission_id)?;
    let Some(metadata) = storage::read(store, &metadata_key, 4096).await? else {
        return Ok(None);
    };
    let source: SourceAdmission = serde_json::from_slice(&metadata)
        .map_err(|_| ApiError::Conflict("recorded source admission is invalid".into()))?;
    // Historical inspection verifies the retained relationship, not today's
    // re-import policy. It does not relabel a derivative's row as an original row.
    if source.organization_id != organization_id
        || source.company_id != company_id
        || source.actor != actor
        || !hex(&source.source_sha256, 64)
        || binding.get("sourceSha256").and_then(Value::as_str)
            != Some(source.source_sha256.as_str())
        || binding.get("sourceDatasetSha256").and_then(Value::as_str)
            != Some(source.dataset_sha256.as_str())
        || binding.get("sourcePolicyVersion").and_then(Value::as_str)
            != Some(source.policy_version.as_str())
    {
        return Err(ApiError::Conflict(
            "recorded source admission scope or identity changed".into(),
        ));
    }
    Ok(Some(
        json!({"sourceAdmissionId":admission_id,"sourceSha256":source.source_sha256,
        "sourceRelationship":"user_prepared_derivative"}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn history_source_binding_requires_exact_native_submission_and_original_admission() {
        let root =
            std::env::temp_dir().join(format!("history-admission-test-{}", rand::random::<u64>()));
        let store = DocumentBlobStoreConfig::Local { root: root.clone() };
        let original = "Original source bytes";
        let content = "name\nPrepared derivative\n";
        let hash = hex::encode(Sha256::digest(content));
        let actor = "ab".repeat(32);
        let request = "cd".repeat(16);
        let id = record_source_admission(
            &store,
            7,
            42,
            &actor,
            original.as_bytes(),
            "csv",
            &"f".repeat(64),
            lumiere_file_inspection::INSPECTION_POLICY_VERSION,
        )
        .await
        .unwrap();
        verify_import_source(&store, 7, 42, &actor, &id, &request, "product", &hash)
            .await
            .unwrap();
        let source = read_import_source_binding(&store, 7, 42, &actor, &request, "product", &hash)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(source["sourceAdmissionId"], id);
        assert_eq!(
            source["sourceSha256"],
            hex::encode(Sha256::digest(original))
        );
        assert_eq!(source["sourceRelationship"], "user_prepared_derivative");
        assert!(
            read_import_source_binding(&store, 7, 42, &actor, &request, "contact", &hash)
                .await
                .is_err()
        );
        assert!(read_import_source_binding(
            &store,
            7,
            42,
            &actor,
            &request,
            "product",
            &"e".repeat(64)
        )
        .await
        .is_err());
        assert!(
            read_import_source_binding(&store, 8, 42, &actor, &request, "product", &hash)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            read_import_source_binding(&store, 7, 43, &actor, &request, "product", &hash)
                .await
                .unwrap()
                .is_none()
        );
        assert!(read_import_source_binding(
            &store,
            7,
            42,
            &"de".repeat(32),
            &request,
            "product",
            &hash
        )
        .await
        .unwrap()
        .is_none());
        let (_, key) = keys(7, &id).unwrap();
        tokio::fs::remove_file(root.join(key)).await.unwrap();
        assert!(
            read_import_source_binding(&store, 7, 42, &actor, &request, "product", &hash)
                .await
                .unwrap()
                .is_none()
        );
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn admission_binds_bytes_scope_policy_and_exact_preparation() {
        let root = std::env::temp_dir().join(format!("admission-test-{}", rand::random::<u64>()));
        let store = DocumentBlobStoreConfig::Local { root: root.clone() };
        let csv = "name\nAcme\n";
        let inspected = lumiere_file_inspection::inspect_csv(csv).unwrap();
        let id = record_source_admission(
            &store,
            7,
            42,
            "actor",
            csv.as_bytes(),
            "csv",
            &inspected.dataset_sha256,
            lumiere_file_inspection::INSPECTION_POLICY_VERSION,
        )
        .await
        .unwrap();
        let hash = &inspected.content_sha256;
        let audit = verify_import_source(&store, 7, 42, "actor", &id, "request", "product", hash)
            .await
            .unwrap();
        assert_eq!(audit["instructionTrust"], "untrusted");
        assert!(
            verify_import_source(&store, 7, 43, "actor", &id, "request", "product", hash)
                .await
                .is_err()
        );
        assert!(
            verify_import_source(&store, 7, 42, "other", &id, "request", "product", hash)
                .await
                .is_err()
        );
        assert!(
            verify_import_source(&store, 8, 42, "actor", &id, "request", "product", hash)
                .await
                .is_err()
        );
        assert!(verify_import_source(
            &store,
            7,
            42,
            "actor",
            &id,
            "request",
            "product",
            &"b".repeat(64)
        )
        .await
        .is_err());
        let (data_key, meta_key) = keys(7, &id).unwrap();
        tokio::fs::write(root.join(&data_key), b"substituted")
            .await
            .unwrap();
        assert!(verify_import_source(
            &store,
            7,
            42,
            "actor",
            &id,
            "other-request",
            "product",
            hash
        )
        .await
        .is_err());
        tokio::fs::write(root.join(data_key), csv).await.unwrap();
        let mut receipt: SourceAdmission =
            serde_json::from_slice(&tokio::fs::read(root.join(&meta_key)).await.unwrap()).unwrap();
        receipt.policy_version = "stale-policy".into();
        tokio::fs::write(root.join(meta_key), serde_json::to_vec(&receipt).unwrap())
            .await
            .unwrap();
        assert!(
            verify_import_source(&store, 7, 42, "actor", &id, "new-request", "product", hash)
                .await
                .is_err()
        );
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
}
