//! Private storage for managed document bytes and upload metadata.
//!
//! Object keys remain stable across a reviewed local-to-S3 migration. Neither
//! backend grants end-user access: callers must authorize the document before
//! reading. Binary writes are create-only; retrying identical bytes is safe.

use std::fmt;
use std::path::PathBuf;

use tokio::io::AsyncWriteExt;

use crate::error::ApiError;

#[derive(Clone, Debug)]
pub enum DocumentBlobStoreConfig {
    Local { root: PathBuf },
    S3(DocumentBlobS3Config),
}

#[derive(Clone)]
pub struct DocumentBlobS3Config {
    pub endpoint: String,
    pub bucket: String,
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub prefix: String,
    /// Older S3-compatible buckets may require path-style addressing.
    pub path_style: bool,
}

impl fmt::Debug for DocumentBlobS3Config {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DocumentBlobS3Config")
            .field("endpoint", &self.endpoint)
            .field("bucket", &self.bucket)
            .field("region", &self.region)
            .field("access_key_id", &"<redacted>")
            .field("secret_access_key", &"<redacted>")
            .field("prefix", &self.prefix)
            .field("path_style", &self.path_style)
            .finish()
    }
}

/// Validate a managed key before either a filesystem join or S3 request.
pub fn validate_key(key: &str) -> Result<(), ApiError> {
    let mut parts = key.split('/');
    let organization = parts.next().unwrap_or_default();
    let residency = parts.next().unwrap_or_default();
    let file = parts.next().unwrap_or_default();
    let organization_id = organization
        .strip_prefix("org-")
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0);
    let object_id = file
        .strip_suffix(".meta.json")
        .or_else(|| file.strip_suffix(".bin"));
    if parts.next().is_some()
        || organization_id.is_none()
        || residency.is_empty()
        || residency.len() > 32
        || !residency
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
        || !object_id.is_some_and(|value| {
            value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
    {
        return Err(ApiError::Unprocessable(
            "invalid document storage key".into(),
        ));
    }
    Ok(())
}

fn local_path(root: &std::path::Path, key: &str) -> Result<PathBuf, ApiError> {
    validate_key(key)?;
    Ok(root.join(key))
}

fn bucket(config: &DocumentBlobS3Config) -> Result<Box<s3::Bucket>, ApiError> {
    let credentials = s3::creds::Credentials::new(
        Some(&config.access_key_id),
        Some(&config.secret_access_key),
        None,
        None,
        None,
    )
    .map_err(|_| ApiError::Internal("configure document storage credentials".into()))?;
    let bucket = s3::Bucket::new(
        &config.bucket,
        s3::Region::Custom {
            region: config.region.clone(),
            endpoint: config.endpoint.clone(),
        },
        credentials,
    )
    .map_err(|_| ApiError::Internal("configure document storage bucket".into()))?;
    Ok(if config.path_style {
        bucket.with_path_style()
    } else {
        bucket
    })
}

fn remote_key(config: &DocumentBlobS3Config, key: &str) -> Result<String, ApiError> {
    validate_key(key)?;
    Ok(format!("{}/{key}", config.prefix))
}

fn storage_error(operation: &str, status: u16) -> ApiError {
    ApiError::Internal(format!(
        "{operation}: document storage returned HTTP {status}"
    ))
}

/// Read a bounded object. Missing objects are distinct from backend failures.
pub async fn read(
    store: &DocumentBlobStoreConfig,
    key: &str,
    max_bytes: u64,
) -> Result<Option<Vec<u8>>, ApiError> {
    let Some(length) = size(store, key).await? else {
        return Ok(None);
    };
    if length > max_bytes {
        return Err(ApiError::Unprocessable(
            "document object exceeds size limit".into(),
        ));
    }
    let result = match store {
        DocumentBlobStoreConfig::Local { root } => {
            match tokio::fs::read(local_path(root, key)?).await {
                Ok(bytes) => Some(bytes),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => {
                    return Err(ApiError::Internal(format!("read document object: {error}")))
                }
            }
        }
        DocumentBlobStoreConfig::S3(config) => {
            let response = bucket(config)?
                .get_object(remote_key(config, key)?)
                .await
                .map_err(|_| ApiError::Internal("read document object from S3".into()))?;
            match response.status_code() {
                200 => Some(response.to_vec()),
                404 => None,
                status => return Err(storage_error("read document object", status)),
            }
        }
    };
    if result
        .as_ref()
        .is_some_and(|bytes| bytes.len() as u64 > max_bytes)
    {
        return Err(ApiError::Unprocessable(
            "document object exceeds size limit".into(),
        ));
    }
    Ok(result)
}

/// Inspect an object without reading its content.
pub async fn size(store: &DocumentBlobStoreConfig, key: &str) -> Result<Option<u64>, ApiError> {
    match store {
        DocumentBlobStoreConfig::Local { root } => {
            match tokio::fs::metadata(local_path(root, key)?).await {
                Ok(metadata) if metadata.is_file() => Ok(Some(metadata.len())),
                Ok(_) => Err(ApiError::Internal("document object is not a file".into())),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(error) => Err(ApiError::Internal(format!(
                    "inspect document object: {error}"
                ))),
            }
        }
        DocumentBlobStoreConfig::S3(config) => {
            let (head, status) = bucket(config)?
                .head_object(remote_key(config, key)?)
                .await
                .map_err(|_| ApiError::Internal("inspect document object in S3".into()))?;
            match status {
                200 => head
                    .content_length
                    .and_then(|value| u64::try_from(value).ok())
                    .map(Some)
                    .ok_or_else(|| {
                        ApiError::Internal("document object has no valid content length".into())
                    }),
                404 => Ok(None),
                status => Err(storage_error("inspect document object", status)),
            }
        }
    }
}

/// Atomically reserve a new key; identical retries cannot replace its content.
/// S3 must honor conditional PUT. Unsupported/error responses fail closed.
pub async fn put_immutable(
    store: &DocumentBlobStoreConfig,
    key: &str,
    bytes: &[u8],
    content_type: &str,
) -> Result<(), ApiError> {
    let exists = match store {
        DocumentBlobStoreConfig::Local { root } => {
            let path = local_path(root, key)?;
            let parent = path
                .parent()
                .ok_or_else(|| ApiError::Internal("document object has no parent".into()))?;
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(ApiError::internal)?;
            // Publish only complete, synced content. hard_link is create-only,
            // unlike rename, so concurrent writers cannot replace a version.
            let temporary = parent.join(format!(".upload-{}", rand::random::<u128>()));
            let mut file = tokio::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)
                .await
                .map_err(ApiError::internal)?;
            let write = async {
                file.write_all(bytes).await?;
                file.sync_all().await
            }
            .await;
            drop(file);
            if let Err(error) = write {
                let _ = tokio::fs::remove_file(&temporary).await;
                return Err(ApiError::internal(error));
            }
            let publish = tokio::fs::hard_link(&temporary, &path).await;
            let cleanup = tokio::fs::remove_file(&temporary).await;
            match publish {
                Ok(()) => {
                    cleanup.map_err(ApiError::internal)?;
                    false
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => true,
                Err(error) => return Err(ApiError::internal(error)),
            }
        }
        DocumentBlobStoreConfig::S3(config) => {
            let mut bucket = bucket(config)?;
            bucket.add_header("If-None-Match", "*");
            let response = bucket
                .put_object_with_content_type(remote_key(config, key)?, bytes, content_type)
                .await
                .map_err(|_| ApiError::Internal("write immutable document object to S3".into()))?;
            match response.status_code() {
                200..=299 => false,
                409 | 412 => true,
                status => return Err(storage_error("write immutable document object", status)),
            }
        }
    };
    if exists && read(store, key, bytes.len() as u64).await?.as_deref() != Some(bytes) {
        return Err(ApiError::Conflict(
            "document object already contains different bytes".into(),
        ));
    }
    Ok(())
}

/// Replace upload metadata atomically. Binary objects never use this operation.
pub async fn write_metadata(
    store: &DocumentBlobStoreConfig,
    key: &str,
    bytes: &[u8],
) -> Result<(), ApiError> {
    validate_key(key)?;
    if !key.ends_with(".meta.json") {
        return Err(ApiError::Unprocessable(
            "only upload metadata may be replaced".into(),
        ));
    }
    match store {
        DocumentBlobStoreConfig::Local { root } => {
            let path = local_path(root, key)?;
            let parent = path
                .parent()
                .ok_or_else(|| ApiError::Internal("document metadata has no parent".into()))?;
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(ApiError::internal)?;
            let temporary = parent.join(format!(".metadata-{}", rand::random::<u128>()));
            let mut file = tokio::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)
                .await
                .map_err(ApiError::internal)?;
            let write = async {
                file.write_all(bytes).await?;
                file.sync_all().await
            }
            .await;
            drop(file);
            if let Err(error) = write {
                let _ = tokio::fs::remove_file(&temporary).await;
                return Err(ApiError::internal(error));
            }
            if let Err(error) = tokio::fs::rename(&temporary, path).await {
                let _ = tokio::fs::remove_file(&temporary).await;
                return Err(ApiError::internal(error));
            }
            Ok(())
        }
        DocumentBlobStoreConfig::S3(config) => {
            let response = bucket(config)?
                .put_object_with_content_type(remote_key(config, key)?, bytes, "application/json")
                .await
                .map_err(|_| ApiError::Internal("write document metadata to S3".into()))?;
            match response.status_code() {
                200..=299 => Ok(()),
                status => Err(storage_error("write document metadata", status)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BINARY: &str = "org-7/eu/0123456789abcdef0123456789abcdef.bin";
    const METADATA: &str = "org-7/eu/0123456789abcdef0123456789abcdef.meta.json";

    struct Fixture {
        root: PathBuf,
        store: DocumentBlobStoreConfig,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("document-store-test-{}", rand::random::<u128>()));
            Self {
                store: DocumentBlobStoreConfig::Local { root: root.clone() },
                root,
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn rejects_paths_outside_managed_object_namespace() {
        for key in [
            "/tmp/file.bin",
            "../file.bin",
            "org-7/../0123456789abcdef0123456789abcdef.bin",
            "org-0/eu/0123456789abcdef0123456789abcdef.bin",
            "org-7/eu/0123456789abcdef0123456789abcdef.bin/extra",
            "org-7/eu/name.bin",
            "org-7/eu/0123456789abcdef0123456789abcdef.txt",
        ] {
            assert!(validate_key(key).is_err(), "{key}");
        }
        assert!(validate_key(BINARY).is_ok());
        assert!(validate_key(METADATA).is_ok());
    }

    #[tokio::test]
    async fn immutable_local_objects_survive_retries_and_reject_replacement() {
        let fixture = Fixture::new();
        assert!(read(&fixture.store, BINARY, 100).await.unwrap().is_none());
        put_immutable(&fixture.store, BINARY, b"original", "application/pdf")
            .await
            .unwrap();
        put_immutable(&fixture.store, BINARY, b"original", "application/pdf")
            .await
            .unwrap();
        assert!(
            put_immutable(&fixture.store, BINARY, b"replaced", "application/pdf")
                .await
                .is_err()
        );
        assert_eq!(
            read(&fixture.store, BINARY, 100).await.unwrap().unwrap(),
            b"original"
        );
        assert!(read(&fixture.store, BINARY, 2).await.is_err());
        assert!(write_metadata(&fixture.store, BINARY, b"overwrite")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn parallel_creation_keeps_exactly_one_complete_version() {
        let fixture = Fixture::new();
        let (first, second) = tokio::join!(
            put_immutable(&fixture.store, BINARY, b"first", "application/pdf"),
            put_immutable(&fixture.store, BINARY, b"second", "application/pdf"),
        );
        assert_ne!(first.is_ok(), second.is_ok());
        let bytes = read(&fixture.store, BINARY, 100).await.unwrap().unwrap();
        assert!(bytes == b"first" || bytes == b"second");
    }

    #[tokio::test]
    async fn metadata_is_replaceable_but_read_failures_are_not_missing_objects() {
        let fixture = Fixture::new();
        put_immutable(
            &fixture.store,
            METADATA,
            b"{\"completed\":false}",
            "application/json",
        )
        .await
        .unwrap();
        write_metadata(&fixture.store, METADATA, b"{\"completed\":true}")
            .await
            .unwrap();
        assert_eq!(
            read(&fixture.store, METADATA, 100).await.unwrap().unwrap(),
            b"{\"completed\":true}"
        );
        tokio::fs::create_dir_all(fixture.root.join(BINARY))
            .await
            .unwrap();
        assert!(read(&fixture.store, BINARY, 100).await.is_err());
    }

    #[derive(Default)]
    struct MockState {
        objects: tokio::sync::Mutex<std::collections::HashMap<String, Vec<u8>>>,
        unavailable: std::sync::atomic::AtomicBool,
        reject_conditionals: std::sync::atomic::AtomicBool,
        conditional_puts: std::sync::atomic::AtomicUsize,
    }

    struct MockS3 {
        store: DocumentBlobStoreConfig,
        state: std::sync::Arc<MockState>,
        task: tokio::task::JoinHandle<()>,
    }

    impl Drop for MockS3 {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    impl MockS3 {
        async fn new() -> Self {
            use axum::{
                extract::State,
                http::{header, HeaderMap, Method, StatusCode, Uri},
                response::{IntoResponse, Response},
            };
            use std::sync::atomic::Ordering;
            async fn request(
                State(state): State<std::sync::Arc<MockState>>,
                method: Method,
                uri: Uri,
                headers: HeaderMap,
                bytes: axum::body::Bytes,
            ) -> Response {
                if state.unavailable.load(Ordering::SeqCst) {
                    return StatusCode::SERVICE_UNAVAILABLE.into_response();
                }
                if !headers.contains_key(header::AUTHORIZATION) {
                    return StatusCode::FORBIDDEN.into_response();
                }
                let key = uri.path().to_owned();
                if method == Method::PUT {
                    let conditional = headers
                        .get(header::IF_NONE_MATCH)
                        .and_then(|value| value.to_str().ok())
                        == Some("*");
                    if conditional {
                        state.conditional_puts.fetch_add(1, Ordering::SeqCst);
                        if state.reject_conditionals.load(Ordering::SeqCst) {
                            return StatusCode::NOT_IMPLEMENTED.into_response();
                        }
                    }
                    let mut objects = state.objects.lock().await;
                    if conditional && objects.contains_key(&key) {
                        return StatusCode::PRECONDITION_FAILED.into_response();
                    }
                    objects.insert(key, bytes.to_vec());
                    return StatusCode::OK.into_response();
                }
                let objects = state.objects.lock().await;
                let Some(bytes) = objects.get(&key) else {
                    return StatusCode::NOT_FOUND.into_response();
                };
                if method == Method::HEAD {
                    return (
                        [(header::CONTENT_LENGTH, bytes.len().to_string())],
                        Vec::<u8>::new(),
                    )
                        .into_response();
                }
                if method == Method::GET {
                    return bytes.clone().into_response();
                }
                StatusCode::METHOD_NOT_ALLOWED.into_response()
            }
            let state = std::sync::Arc::new(MockState::default());
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = format!("http://{}", listener.local_addr().unwrap());
            let router = axum::Router::new()
                .route("/*key", axum::routing::any(request))
                .with_state(state.clone());
            let task = tokio::spawn(async move {
                axum::serve(listener, router).await.unwrap();
            });
            let store = DocumentBlobStoreConfig::S3(DocumentBlobS3Config {
                endpoint,
                bucket: "documents".into(),
                region: "auto".into(),
                access_key_id: "test-access".into(),
                secret_access_key: "test-secret".into(),
                prefix: "document-blobs".into(),
                path_style: true,
            });
            Self { store, state, task }
        }
    }

    #[tokio::test]
    async fn s3_uses_private_namespaced_conditional_writes_and_preserves_originals() {
        use std::sync::atomic::Ordering;
        let fixture = MockS3::new().await;
        assert!(read(&fixture.store, BINARY, 100).await.unwrap().is_none());
        put_immutable(&fixture.store, BINARY, b"original", "application/pdf")
            .await
            .unwrap();
        put_immutable(&fixture.store, BINARY, b"original", "application/pdf")
            .await
            .unwrap();
        assert!(
            put_immutable(&fixture.store, BINARY, b"replaced", "application/pdf")
                .await
                .is_err()
        );
        assert_eq!(
            read(&fixture.store, BINARY, 100).await.unwrap().unwrap(),
            b"original"
        );
        assert!(read(&fixture.store, BINARY, 2).await.is_err());
        assert_eq!(fixture.state.conditional_puts.load(Ordering::SeqCst), 3);
        assert!(fixture
            .state
            .objects
            .lock()
            .await
            .contains_key(&format!("/documents/document-blobs/{BINARY}")));
        put_immutable(&fixture.store, METADATA, b"pending", "application/json")
            .await
            .unwrap();
        write_metadata(&fixture.store, METADATA, b"completed")
            .await
            .unwrap();
        assert_eq!(
            read(&fixture.store, METADATA, 100).await.unwrap().unwrap(),
            b"completed"
        );
        assert!(write_metadata(&fixture.store, BINARY, b"replacement")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn s3_errors_and_unsupported_conditionals_never_fall_back_to_an_overwrite() {
        use std::sync::atomic::Ordering;
        let fixture = MockS3::new().await;
        fixture
            .state
            .reject_conditionals
            .store(true, Ordering::SeqCst);
        assert!(
            put_immutable(&fixture.store, BINARY, b"original", "application/pdf")
                .await
                .is_err()
        );
        assert!(fixture.state.objects.lock().await.is_empty());
        fixture.state.unavailable.store(true, Ordering::SeqCst);
        assert!(read(&fixture.store, BINARY, 100).await.is_err());
        assert!(write_metadata(&fixture.store, METADATA, b"completed")
            .await
            .is_err());
    }
}
