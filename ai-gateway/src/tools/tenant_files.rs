//! Scope-bound virtual files for deterministic certification.
//!
//! This broker has no host root and accepts no desktop grants. The only bytes
//! it can return are strings embedded in the exact pinned certification
//! environment.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;
use thiserror::Error;

use crate::harness::{
    certification_fixtures::{
        CapabilityEvidence, CertificationTenantScope, MAX_CERTIFICATION_OUTPUT_BYTES,
    },
    release_registry::CandidateCertificationEnvironment,
};

#[derive(Clone, Debug)]
pub struct VirtualTenantFiles {
    scope: CertificationTenantScope,
    files: BTreeMap<String, String>,
    allowed_paths: BTreeSet<String>,
    environment_fingerprint: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct VirtualFileResult {
    pub content: Value,
    pub evidence: CapabilityEvidence,
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum TenantFileError {
    #[error("virtual files must be an object")]
    FilesMustBeObject,
    #[error("virtual file path is not a safe normalized relative path")]
    UnsafePath,
    #[error("virtual file '{0}' content must be a string")]
    ContentMustBeString(String),
    #[error("virtual file '{0}' is not declared for this adapter")]
    PathNotAllowed(String),
    #[error("virtual file '{0}' was not found")]
    FileNotFound(String),
    #[error("virtual file exceeds the certification byte limit")]
    FileTooLarge,
    #[error("virtual file is not valid JSON: {0}")]
    InvalidJson(String),
    #[error("virtual file does not match the claimed tenant scope")]
    ScopeMismatch,
    #[error("virtual file is missing its content field")]
    MissingContent,
}

impl VirtualTenantFiles {
    pub fn parse(
        scope: CertificationTenantScope,
        allowed_paths: impl IntoIterator<Item = impl Into<String>>,
        environment: &CandidateCertificationEnvironment,
    ) -> Result<Self, TenantFileError> {
        let entries = environment
            .virtual_files
            .as_object()
            .ok_or(TenantFileError::FilesMustBeObject)?;
        let allowed_paths = allowed_paths
            .into_iter()
            .map(Into::into)
            .collect::<BTreeSet<_>>();
        let mut files = BTreeMap::new();
        for (path, content) in entries {
            validate_virtual_path(path)?;
            let content = content
                .as_str()
                .ok_or_else(|| TenantFileError::ContentMustBeString(path.clone()))?;
            files.insert(path.clone(), content.to_string());
        }
        Ok(Self {
            scope,
            files,
            allowed_paths,
            environment_fingerprint: environment.environment_fingerprint.clone(),
        })
    }

    pub fn read_scoped_json(&self, path: &str) -> Result<VirtualFileResult, TenantFileError> {
        validate_virtual_path(path)?;
        if !self.allowed_paths.contains(path) {
            return Err(TenantFileError::PathNotAllowed(path.to_string()));
        }
        let raw = self
            .files
            .get(path)
            .ok_or_else(|| TenantFileError::FileNotFound(path.to_string()))?;
        if raw.len() > MAX_CERTIFICATION_OUTPUT_BYTES {
            return Err(TenantFileError::FileTooLarge);
        }
        let envelope: Value = serde_json::from_str(raw)
            .map_err(|error| TenantFileError::InvalidJson(error.to_string()))?;
        let organization_id = row_u64(&envelope, "organizationId", "organization_id");
        let company_id = row_u64(&envelope, "companyId", "company_id");
        if organization_id != Some(self.scope.organization_id)
            || company_id != Some(self.scope.company_id)
        {
            return Err(TenantFileError::ScopeMismatch);
        }
        let content = envelope
            .get("content")
            .cloned()
            .ok_or(TenantFileError::MissingContent)?;
        let encoded = serde_json::to_vec(&content)
            .map_err(|error| TenantFileError::InvalidJson(error.to_string()))?;
        if encoded.len() > MAX_CERTIFICATION_OUTPUT_BYTES {
            return Err(TenantFileError::FileTooLarge);
        }
        let evidence = CapabilityEvidence::new(
            "tenant_virtual_file_read",
            self.scope,
            path,
            &self.environment_fingerprint,
            &Value::String(path.to_string()),
            &content,
        );
        Ok(VirtualFileResult { content, evidence })
    }
}

pub fn validate_virtual_path(path: &str) -> Result<(), TenantFileError> {
    if path.is_empty()
        || path.len() > 512
        || path != path.trim()
        || path.starts_with(['/', '\\', '~'])
        || path.contains(['\\', ':'])
        || path.chars().any(char::is_control)
        || path
            .split('/')
            .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
    {
        return Err(TenantFileError::UnsafePath);
    }
    Ok(())
}

use crate::wire_decode::row_u64;

#[cfg(test)]
mod tests {
    use super::*;

    fn environment(files: Value) -> CandidateCertificationEnvironment {
        CandidateCertificationEnvironment {
            id: 1,
            organization_id: 7,
            skill_id: 2,
            fixture_id: 3,
            dataset: serde_json::json!({}),
            virtual_files: files,
            environment_fingerprint: format!("sha256:{}", "a".repeat(64)),
        }
    }

    #[test]
    fn declared_scoped_virtual_file_succeeds() {
        let files = VirtualTenantFiles::parse(
            CertificationTenantScope::new(7, 9).expect("scope"),
            ["reports/preview.json"],
            &environment(serde_json::json!({
                "reports/preview.json": serde_json::json!({
                    "organizationId": 7,
                    "companyId": 9,
                    "content": {"ok": true}
                }).to_string()
            })),
        )
        .expect("virtual files");

        let result = files
            .read_scoped_json("reports/preview.json")
            .expect("declared file");
        assert_eq!(result.content, serde_json::json!({"ok": true}));
        assert!(result.evidence.evidence_hash.starts_with("sha256:"));
    }

    #[test]
    fn absolute_traversal_and_windows_paths_are_denied() {
        for path in [
            "/etc/passwd",
            "../secret",
            "reports/../../secret",
            r"C:\Users\secret",
            r"reports\preview.json",
            "~/secret",
        ] {
            assert_eq!(
                validate_virtual_path(path),
                Err(TenantFileError::UnsafePath),
                "{path}"
            );
        }
    }

    #[test]
    fn cross_tenant_and_undeclared_file_reads_are_denied() {
        let files = VirtualTenantFiles::parse(
            CertificationTenantScope::new(7, 9).expect("scope"),
            ["reports/preview.json"],
            &environment(serde_json::json!({
                "reports/preview.json": serde_json::json!({
                    "organizationId": 7,
                    "companyId": 10,
                    "content": {}
                }).to_string()
            })),
        )
        .expect("virtual files");

        assert_eq!(
            files.read_scoped_json("reports/preview.json"),
            Err(TenantFileError::ScopeMismatch)
        );
        assert_eq!(
            files.read_scoped_json("reports/other.json"),
            Err(TenantFileError::PathNotAllowed(
                "reports/other.json".to_string()
            ))
        );
    }

    #[test]
    fn symlink_shaped_entries_are_rejected() {
        assert_eq!(
            VirtualTenantFiles::parse(
                CertificationTenantScope::new(7, 9).expect("scope"),
                ["reports/preview.json"],
                &environment(serde_json::json!({
                    "reports/preview.json": {"symlink": "../../etc/passwd"}
                })),
            )
            .expect_err("non-string/symlink entry must fail"),
            TenantFileError::ContentMustBeString("reports/preview.json".to_string())
        );
    }

    #[test]
    fn oversized_virtual_file_is_denied() {
        let oversized = "x".repeat(MAX_CERTIFICATION_OUTPUT_BYTES + 1);
        let files = VirtualTenantFiles::parse(
            CertificationTenantScope::new(7, 9).expect("scope"),
            ["reports/preview.json"],
            &environment(serde_json::json!({
                "reports/preview.json": oversized
            })),
        )
        .expect("virtual files");

        assert_eq!(
            files.read_scoped_json("reports/preview.json"),
            Err(TenantFileError::FileTooLarge)
        );
    }
}
