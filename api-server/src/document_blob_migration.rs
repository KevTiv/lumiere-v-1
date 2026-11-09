//! Reviewed, resumable copies of the complete managed-document object namespace.
//!
//! Migration never changes a document reference, access policy, storage backend,
//! or source object. A manifest includes historical versions, import originals,
//! and recovery sidecars, and binds an independently exported reference inventory.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::document_blob_store::{self as storage, DocumentBlobStoreConfig};

const MAX_OBJECT_BYTES: u64 = 50 * 1024 * 1024;
const MAX_METADATA_BYTES: u64 = 4 * 1024 * 1024;
const MANIFEST_VERSION: u32 = 1;

/// One authoritative document, historical version, or saved import reference.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MigrationReference {
    /// Source collection, such as `document`, `document_version`, or `import_original`.
    pub kind: String,
    /// Stable source record identity; used for missing-reference diagnostics.
    pub record_id: String,
    /// Logical key including `.bin` or `.meta.json`, without the S3 prefix.
    pub key: String,
    /// Checksum from the authoritative source record, not the local file scan.
    pub sha256: String,
}

/// Immutable byte identity for an object that must survive migration.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MigrationObject {
    pub key: String,
    pub bytes: u64,
    pub sha256: String,
}

/// Reviewable snapshot. Never contains storage credentials or document bytes.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MigrationManifest {
    pub version: u32,
    pub references: Vec<MigrationReference>,
    pub objects: Vec<MigrationObject>,
}

/// Evidence of a complete readback; does not activate a storage backend.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationVerification {
    pub manifest_sha256: String,
    /// Non-secret storage identity; binds the report to the inspected destination.
    pub storage: String,
    /// S3 verification covers the manifest, not unrelated or newly written keys.
    pub complete_local_inventory: bool,
    pub verified_objects: usize,
    pub verified_references: usize,
    pub verified_bytes: u64,
}

fn checksum(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn valid_checksum(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn limit(key: &str) -> u64 {
    if key.ends_with(".bin") {
        MAX_OBJECT_BYTES
    } else {
        MAX_METADATA_BYTES
    }
}

async fn local_keys(root: &Path) -> Result<Vec<String>> {
    let mut pending = vec![root.to_path_buf()];
    let mut keys = Vec::new();
    while let Some(directory) = pending.pop() {
        let metadata = tokio::fs::symlink_metadata(&directory).await?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            bail!("source directories must be regular directories");
        }
        let mut entries = tokio::fs::read_dir(&directory).await?;
        while let Some(entry) = entries.next_entry().await? {
            let kind = entry.file_type().await?;
            let path = entry.path();
            if kind.is_symlink() {
                bail!("symbolic links are not valid migration sources");
            }
            if kind.is_dir() {
                if path.strip_prefix(root)?.components().count() > 2 {
                    bail!("unexpected directory in document storage");
                }
                pending.push(path);
            } else if kind.is_file() {
                let key = path
                    .strip_prefix(root)?
                    .to_str()
                    .context("document storage key is not UTF-8")?
                    .to_owned();
                storage::validate_key(&key).map_err(anyhow::Error::new)?;
                keys.push(key);
            } else {
                bail!("document storage contains a non-regular object");
            }
        }
    }
    keys.sort();
    Ok(keys)
}

async fn read_object(store: &DocumentBlobStoreConfig, key: &str) -> Result<Vec<u8>> {
    if let DocumentBlobStoreConfig::Local { root } = store {
        let mut path = root.clone();
        for part in key.split('/') {
            path.push(part);
            if tokio::fs::symlink_metadata(&path)
                .await
                .with_context(|| format!("missing migration object {key}"))?
                .file_type()
                .is_symlink()
            {
                bail!("symbolic links are not valid migration sources");
            }
        }
    }
    storage::read(store, key, limit(key))
        .await
        .map_err(anyhow::Error::new)?
        .with_context(|| format!("missing migration object {key}"))
}

fn verify_identity(object: &MigrationObject, bytes: &[u8]) -> Result<()> {
    if bytes.len() as u64 != object.bytes || checksum(bytes) != object.sha256 {
        bail!("migration checksum or length mismatch for {}", object.key);
    }
    Ok(())
}

fn validate_manifest(manifest: &MigrationManifest) -> Result<()> {
    if manifest.version != MANIFEST_VERSION || manifest.objects.is_empty() {
        bail!("unsupported or empty document migration manifest");
    }
    let mut objects = BTreeMap::new();
    for object in &manifest.objects {
        storage::validate_key(&object.key).map_err(anyhow::Error::new)?;
        if !valid_checksum(&object.sha256) || object.bytes > limit(&object.key) {
            bail!("invalid object identity for {}", object.key);
        }
        if objects.insert(&object.key, object).is_some() {
            bail!("duplicate object in migration manifest");
        }
    }
    let mut references = BTreeSet::new();
    for reference in &manifest.references {
        if !matches!(
            reference.kind.as_str(),
            "document"
                | "document_version"
                | "import_original"
                | "import_preparation"
                | "import_review_binding"
        ) || reference.record_id.trim().is_empty()
            || !references.insert((&reference.kind, &reference.record_id))
            || !valid_checksum(&reference.sha256)
        {
            bail!("invalid or duplicate source reference");
        }
        let object = objects.get(&reference.key).with_context(|| {
            format!(
                "missing {} reference {}",
                reference.kind, reference.record_id
            )
        })?;
        if object.sha256 != reference.sha256 {
            bail!(
                "source record checksum differs for {} {}",
                reference.kind,
                reference.record_id
            );
        }
    }
    Ok(())
}

async fn validate_pairs(
    store: &DocumentBlobStoreConfig,
    objects: &[MigrationObject],
) -> Result<()> {
    let by_key: BTreeMap<_, _> = objects
        .iter()
        .map(|object| (object.key.as_str(), object))
        .collect();
    for object in objects {
        let parts: Vec<_> = object.key.split('/').collect();
        let namespace = parts[1];
        if object.key.ends_with(".bin") {
            let metadata_key = object.key.replace(".bin", ".meta.json");
            if !by_key.contains_key(metadata_key.as_str()) {
                bail!("binary has no metadata: {}", object.key);
            }
            continue;
        }
        if matches!(
            namespace,
            "upload-receipts" | "import-preparations" | "import-review-bindings"
        ) {
            // These are metadata-only recovery/provenance objects, not uploads.
            continue;
        }
        let binary_key = object.key.replace(".meta.json", ".bin");
        let binary = by_key
            .get(binary_key.as_str())
            .context("metadata has no binary")?;
        let bytes = read_object(store, &object.key).await?;
        verify_identity(object, &bytes)?;
        let metadata: Value = serde_json::from_slice(&bytes).context("invalid object metadata")?;
        let organization: u64 = parts[0]
            .strip_prefix("org-")
            .context("invalid organization")?
            .parse()?;
        let (org_field, size_field, hash_field) = if namespace == "import-admissions" {
            if metadata
                .get("actor")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
                || metadata
                    .get("company_id")
                    .and_then(Value::as_u64)
                    .is_none_or(|id| id == 0)
            {
                bail!("import original has no trusted owner scope");
            }
            ("organization_id", "source_size", "source_sha256")
        } else {
            if metadata.get("completed").and_then(Value::as_bool) != Some(true) {
                bail!(
                    "incomplete upload must be resolved before migration: {}",
                    object.key
                );
            }
            let creator = metadata
                .get("createdBy")
                .and_then(Value::as_str)
                .or_else(|| {
                    (metadata.get("generatedPdf").and_then(Value::as_bool) == Some(true))
                        .then(|| metadata.get("generatedBy").and_then(Value::as_str))
                        .flatten()
                });
            if creator.is_none_or(str::is_empty)
                || metadata.get("objectKey").and_then(Value::as_str)
                    != Some(binary_key.trim_end_matches(".bin"))
            {
                bail!(
                    "document metadata has no matching trusted provenance: {}",
                    object.key
                );
            }
            ("organizationId", "actualSize", "actualChecksum")
        };
        if metadata.get(org_field).and_then(Value::as_u64) != Some(organization)
            || metadata.get(size_field).and_then(Value::as_u64) != Some(binary.bytes)
            || metadata.get(hash_field).and_then(Value::as_str) != Some(binary.sha256.as_str())
        {
            bail!("metadata does not match the stored bytes: {}", object.key);
        }
    }
    Ok(())
}

/// Inventory every local object, then reconcile authoritative saved references.
pub async fn plan_local(
    root: PathBuf,
    references: Vec<MigrationReference>,
) -> Result<MigrationManifest> {
    let store = DocumentBlobStoreConfig::Local { root: root.clone() };
    let mut objects = Vec::new();
    for key in local_keys(&root).await? {
        let bytes = read_object(&store, &key).await?;
        objects.push(MigrationObject {
            key,
            bytes: bytes.len() as u64,
            sha256: checksum(&bytes),
        });
    }
    let manifest = MigrationManifest {
        version: MANIFEST_VERSION,
        references,
        objects,
    };
    validate_manifest(&manifest)?;
    validate_pairs(&store, &manifest.objects).await?;
    Ok(manifest)
}

/// Read back every object and require the complete local inventory to remain fixed.
pub async fn verify(
    manifest: &MigrationManifest,
    store: &DocumentBlobStoreConfig,
) -> Result<MigrationVerification> {
    validate_manifest(manifest)?;
    if let DocumentBlobStoreConfig::Local { root } = store {
        let expected: BTreeSet<_> = manifest
            .objects
            .iter()
            .map(|object| object.key.clone())
            .collect();
        if local_keys(root).await?.into_iter().collect::<BTreeSet<_>>() != expected {
            bail!("local inventory changed; create and review a fresh manifest");
        }
    }
    for object in &manifest.objects {
        verify_identity(object, &read_object(store, &object.key).await?)?;
    }
    validate_pairs(store, &manifest.objects).await?;
    Ok(MigrationVerification {
        manifest_sha256: checksum(&serde_json::to_vec(manifest)?),
        storage: match store {
            DocumentBlobStoreConfig::Local { root } => format!("local:{}", root.display()),
            DocumentBlobStoreConfig::S3(config) => {
                format!("s3:{}/{}/{}", config.endpoint, config.bucket, config.prefix)
            }
        },
        complete_local_inventory: matches!(store, DocumentBlobStoreConfig::Local { .. }),
        verified_objects: manifest.objects.len(),
        verified_references: manifest.references.len(),
        verified_bytes: manifest.objects.iter().map(|object| object.bytes).sum(),
    })
}

/// Copy with create-only writes. A restart accepts only exact destination matches.
/// The caller must fence all writers before invoking this operation.
pub async fn copy_verified(
    manifest: &MigrationManifest,
    source: &DocumentBlobStoreConfig,
    destination: &DocumentBlobStoreConfig,
) -> Result<MigrationVerification> {
    verify(manifest, source).await?;
    let mut objects: Vec<_> = manifest.objects.iter().collect();
    // Publish bytes before metadata so an interrupted copy never admits missing bytes.
    objects.sort_by_key(|object| (!object.key.ends_with(".bin"), &object.key));
    for object in objects {
        let bytes = read_object(source, &object.key).await?;
        verify_identity(object, &bytes)?;
        storage::put_immutable(destination, &object.key, &bytes, "application/octet-stream")
            .await
            .map_err(anyhow::Error::new)?;
        verify_identity(object, &read_object(destination, &object.key).await?)?;
    }
    // Detect writes that raced the copy, including completed sidecar changes.
    verify(manifest, source).await?;
    verify(manifest, destination).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            Self(
                std::env::temp_dir().join(format!("document-migration-{}", rand::random::<u128>())),
            )
        }

        fn store(&self) -> DocumentBlobStoreConfig {
            DocumentBlobStoreConfig::Local {
                root: self.0.clone(),
            }
        }

        async fn document(&self, id: u32, content: &[u8]) -> MigrationReference {
            let key = format!("org-7/eu/{id:032x}");
            let metadata = json!({"organizationId":7,"companyId":9,"objectKey":key,
                "completed":true,"createdBy":"owner","actualSize":content.len(),
                "actualChecksum":checksum(content)});
            storage::put_immutable(&self.store(), &format!("{key}.bin"), content, "text/plain")
                .await
                .unwrap();
            storage::put_immutable(
                &self.store(),
                &format!("{key}.meta.json"),
                &serde_json::to_vec(&metadata).unwrap(),
                "application/json",
            )
            .await
            .unwrap();
            MigrationReference {
                kind: "document_version".into(),
                record_id: id.to_string(),
                key: format!("{key}.bin"),
                sha256: checksum(content),
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn copies_historical_versions_import_originals_and_recovery_sidecars() {
        let source = Fixture::new();
        let target = Fixture::new();
        let restored = Fixture::new();
        let old = source.document(1, b"historical version").await;
        let current = source.document(2, b"current version").await;
        let original = b"name,amount\noriginal,14\n";
        let source_key = "org-7/import-admissions/00000000000000000000000000000003";
        let admission = json!({"organization_id":7,"company_id":9,"actor":"owner", "source_size":original.len(),"source_sha256":checksum(original)});
        storage::put_immutable(
            &source.store(),
            &format!("{source_key}.bin"),
            original,
            "text/csv",
        )
        .await
        .unwrap();
        storage::put_immutable(
            &source.store(),
            &format!("{source_key}.meta.json"),
            &serde_json::to_vec(&admission).unwrap(),
            "application/json",
        )
        .await
        .unwrap();
        for namespace in [
            "import-preparations",
            "import-review-bindings",
            "upload-receipts",
        ] {
            storage::put_immutable(
                &source.store(),
                &format!("org-7/{namespace}/00000000000000000000000000000004.meta.json"),
                b"saved-recovery-evidence",
                "text/plain",
            )
            .await
            .unwrap();
        }
        let references = vec![
            old,
            current,
            MigrationReference {
                kind: "import_original".into(),
                record_id: "3".into(),
                key: format!("{source_key}.bin"),
                sha256: checksum(original),
            },
        ];
        let manifest = plan_local(source.0.clone(), references).await.unwrap();
        assert_eq!(manifest.objects.len(), 9);
        // Simulate an interrupted first copy: binary exists but its metadata does not.
        let object = &manifest.objects[0];
        let bytes = read_object(&source.store(), &object.key).await.unwrap();
        storage::put_immutable(&target.store(), &object.key, &bytes, "text/plain")
            .await
            .unwrap();
        let report = copy_verified(&manifest, &source.store(), &target.store())
            .await
            .unwrap();
        assert_eq!(report.verified_objects, 9);
        copy_verified(&manifest, &source.store(), &target.store())
            .await
            .unwrap();
        copy_verified(&manifest, &target.store(), &restored.store())
            .await
            .unwrap();
        assert_eq!(
            verify(&manifest, &restored.store())
                .await
                .unwrap()
                .manifest_sha256,
            report.manifest_sha256
        );
    }

    #[tokio::test]
    async fn rejects_missing_references_changed_sources_and_conflicting_destinations() {
        let source = Fixture::new();
        let target = Fixture::new();
        let reference = source.document(1, b"original").await;
        let mut missing = reference.clone();
        missing.key = "org-7/eu/00000000000000000000000000000009.bin".into();
        assert!(plan_local(source.0.clone(), vec![missing]).await.is_err());
        let manifest = plan_local(source.0.clone(), vec![reference.clone()])
            .await
            .unwrap();
        storage::put_immutable(&target.store(), &reference.key, b"conflict", "text/plain")
            .await
            .unwrap();
        assert!(copy_verified(&manifest, &source.store(), &target.store())
            .await
            .is_err());
        assert_eq!(
            read_object(&target.store(), &reference.key).await.unwrap(),
            b"conflict"
        );
        source.document(2, b"write after inventory").await;
        assert!(verify(&manifest, &source.store()).await.is_err());
    }

    #[tokio::test]
    async fn incomplete_or_corrupt_pairs_cannot_be_certified() {
        let source = Fixture::new();
        let reference = source.document(1, b"original").await;
        let manifest = plan_local(source.0.clone(), vec![reference.clone()])
            .await
            .unwrap();
        tokio::fs::write(source.0.join(&reference.key), b"tampered")
            .await
            .unwrap();
        assert!(verify(&manifest, &source.store()).await.is_err());
        assert!(plan_local(source.0.clone(), vec![reference.clone()])
            .await
            .is_err());
        tokio::fs::remove_file(source.0.join(&reference.key))
            .await
            .unwrap();
        assert!(plan_local(source.0.clone(), vec![]).await.is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_symlinks_even_when_the_target_is_a_valid_object() {
        let source = Fixture::new();
        let reference = source.document(1, b"original").await;
        let link = source
            .0
            .join("org-7/eu/00000000000000000000000000000002.bin");
        std::os::unix::fs::symlink(source.0.join(reference.key), link).unwrap();
        assert!(plan_local(source.0.clone(), vec![]).await.is_err());
    }
}
