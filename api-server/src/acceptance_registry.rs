//! Bounded owner reads for the private release acceptance registry.

use serde_json::Value;
use stdb_client::StdbClient;

use crate::{error::ApiError, routes::ai_chat_acceptance::VerifiedAcceptanceJob, state::AppState};

const MAX_MANIFEST_BYTES: usize = 64 * 1024;

pub(crate) struct AcceptanceRegistry<'a> {
    client: StdbClient,
    job: &'a VerifiedAcceptanceJob<'a>,
}

impl<'a> AcceptanceRegistry<'a> {
    pub(crate) fn for_verified_job(
        state: &AppState,
        job: &'a VerifiedAcceptanceJob<'a>,
    ) -> Result<Self, ApiError> {
        // The owner credential can read the private table. Scope comes strictly
        // from the verified GitHub job and attested web release.
        let client = state
            .stdb
            .with_query_limits(2, MAX_MANIFEST_BYTES * 2)
            .map_err(ApiError::internal)?;
        Ok(Self { client, job })
    }

    pub(crate) async fn manifest(&self) -> Result<Option<Value>, ApiError> {
        let (org, environment, release_sha) = self.job.registry_scope();
        let rows = self
            .client
            .query_sql(&format!(
            "SELECT fixture_json FROM ai_chat_acceptance_fixture WHERE organization_id = {org} \
             AND environment = '{environment}' AND release_sha = '{release_sha}' LIMIT 2"
        ))
            .await
            .map_err(ApiError::unavailable)?;
        match rows.as_slice() {
            [] => Ok(None),
            [row] => {
                let manifest = row["fixtureJson"]
                    .as_str()
                    .filter(|text| text.len() <= MAX_MANIFEST_BYTES)
                    .and_then(|text| serde_json::from_str(text).ok())
                    .filter(Value::is_object)
                    .ok_or_else(|| {
                        ApiError::Unavailable("Acceptance registry has an invalid manifest".into())
                    })?;
                Ok(Some(manifest))
            }
            _ => Err(ApiError::Unavailable(
                "Acceptance registry has duplicate manifests".into(),
            )),
        }
    }

    pub(crate) async fn verify_provisioning_dates(
        &self,
        company: u64,
        document: u64,
        activated_at: i64,
    ) -> Result<(), ApiError> {
        let (org, _, _) = self.job.registry_scope();
        let company_sql = format!(
        "SELECT created_at FROM company WHERE organization_id = {org} AND id = {company} LIMIT 1"
    );
        let document_sql = format!(
        "SELECT company_id, create_date FROM document WHERE organization_id = {org} AND id = {document} LIMIT 1"
    );
        let (companies, documents) = tokio::try_join!(
            self.client.query_sql(&company_sql),
            self.client.query_sql(&document_sql),
        )
        .map_err(ApiError::unavailable)?;
        let new = |timestamp: &Value| {
            crate::session::timestamp_micros(timestamp).is_some_and(|micros| micros > activated_at)
        };
        if matches!(companies.as_slice(), [row] if new(&row["createdAt"]))
            && matches!(documents.as_slice(), [row] if row["companyId"].as_u64() == Some(company) && new(&row["createDate"]))
        {
            Ok(())
        } else {
            Err(ApiError::Conflict(
                "Fresh acceptance company and source must be created for this candidate".into(),
            ))
        }
    }

    pub(crate) async fn verify_upgraded_source(&self, upgraded: &Value) -> Result<(), ApiError> {
        let (org, _, _) = self.job.registry_scope();
        let stale = || {
            ApiError::Conflict(
                "Upgraded acceptance document is no longer current and indexed".into(),
            )
        };
        let company = upgraded["companyId"]
            .as_u64()
            .filter(|id| *id > 0)
            .ok_or_else(stale)?;
        let document = upgraded["documentId"]
            .as_u64()
            .filter(|id| *id > 0)
            .ok_or_else(stale)?;
        let version = upgraded["sourceVersion"]
            .as_str()
            .filter(|text| {
                text.strip_prefix('v')
                    .and_then(|rest| rest.split_once('-'))
                    .is_some_and(|(number, hash)| {
                        number.parse::<u32>().is_ok()
                            && hash.len() == 16
                            && hash
                                .bytes()
                                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                    })
            })
            .ok_or_else(stale)?;
        let rows = self
            .client
            .query_sql(&format!(
                "SELECT company_id, current_version_id, is_deleted FROM document \
         WHERE organization_id = {org} AND id = {document} LIMIT 1"
            ))
            .await
            .map_err(ApiError::unavailable)?;
        let [row] = rows.as_slice() else {
            return Err(stale());
        };
        let current = row["currentVersionId"]
            .as_u64()
            .filter(|id| *id > 0)
            .ok_or_else(stale)?;
        if row["companyId"].as_u64() != Some(company) || row["isDeleted"].as_bool() != Some(false) {
            return Err(stale());
        }
        let rows = self
            .client
            .query_sql(&format!(
            "SELECT version_number, checksum FROM document_version WHERE organization_id = {org} \
         AND document_id = {document} AND id = {current} AND is_current = true LIMIT 1"
        ))
            .await
            .map_err(ApiError::unavailable)?;
        let [row] = rows.as_slice() else {
            return Err(stale());
        };
        let number = row["versionNumber"].as_u64().ok_or_else(stale)?;
        let prefix = row["checksum"]
            .as_str()
            .and_then(|checksum| checksum.get(..16))
            .ok_or_else(stale)?;
        if format!("v{number}-{}", prefix.to_ascii_lowercase()) != version {
            return Err(stale());
        }
        let rows = self.client.query_sql(&format!(
        "SELECT source_version_id FROM ai_evidence_passage WHERE organization_id = {org} AND company_id = {company} \
         AND source_kind = 'document' AND source_key = 'document:{document}' \
         AND source_version = '{version}' AND status = 'current' AND text_state = 'present' LIMIT 1"
    )).await.map_err(ApiError::unavailable)?;
        if !rows
            .iter()
            .any(|row| row["sourceVersionId"].as_u64().is_some_and(|id| id > 0))
        {
            return Err(stale());
        }
        Ok(())
    }
}
