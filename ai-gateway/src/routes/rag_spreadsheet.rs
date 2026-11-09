//! Resolve selected spreadsheet cells through their owning API with current actor authority.
use std::time::Duration;

use anyhow::{bail, Context, Result};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{harness::ActorCredentials, state::AppState};

use super::RagSource;

const MAX_EVIDENCE_BYTES: usize = 8192;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SpreadsheetSelection {
    document_id: String,
    version_id: String,
    current: bool,
    checksum: String,
    sheet_name: String,
    first_row: usize,
    last_row: usize,
    first_column: usize,
    last_column: usize,
    delimiter: Option<char>,
    encoding: Option<String>,
    header_row: Option<usize>,
}

#[derive(Clone)]
pub(super) struct AuthorizedSelection {
    pub evidence: Value,
    pub digest: String,
}

impl AuthorizedSelection {
    pub fn source(&self) -> RagSource {
        let string = |name: &str| self.evidence[name].as_str().map(str::to_owned);
        RagSource {
            kind: "passage".into(),
            trust: "persisted".into(),
            instruction_trust: "untrusted",
            entity_type: Some("document".into()),
            entity_id: string("documentId"),
            source_kind: Some("managed_document_selection".into()),
            passage_id: None,
            score: 1.0,
            text_snippet: "Selected spreadsheet cells".into(),
            label: Some(format!(
                "{} · R{}C{}:R{}C{}",
                self.evidence["sheetName"].as_str().unwrap_or("Worksheet"),
                self.evidence["firstRow"],
                self.evidence["firstColumn"],
                self.evidence["lastRow"],
                self.evidence["lastColumn"],
            )),
            field: None,
            snapshot_at: None,
            source_key: None,
            source_version: string("versionId"),
            passage_key: None,
            content_hash: string("checksum"),
        }
    }
}

pub(super) struct SpreadsheetAccess<'a> {
    pub state: &'a AppState,
    pub actor: &'a ActorCredentials,
    pub organization_id: u64,
    pub company_id: u64,
}

impl SpreadsheetAccess<'_> {
    pub async fn read(&self, selection: &SpreadsheetSelection) -> Result<AuthorizedSelection> {
        let base = self
            .state
            .config
            .api_server_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .context("spreadsheet authority is unavailable")?
            .trim_end_matches('/');
        let mut request = serde_json::to_value(selection)?;
        // The tenant and company are injected by the authorized RAG request.
        request["organizationId"] = self.organization_id.into();
        request["companyId"] = self.company_id.into();
        let response = self
            .state
            .http
            .post(format!(
                "{base}/v1/documents/spreadsheet/selection-evidence"
            ))
            .bearer_auth(&self.actor.stdb_token)
            .header("x-stdb-identity", &self.actor.identity_hex)
            .timeout(Duration::from_secs(20))
            .json(&request)
            .send()
            .await
            .context("spreadsheet authority is unavailable")?;
        if !response.status().is_success()
            || response
                .content_length()
                .is_some_and(|size| size > MAX_EVIDENCE_BYTES as u64)
        {
            bail!("selected spreadsheet cells could not be authorized or checked");
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.context("spreadsheet authority is unavailable")?;
            if bytes.len().saturating_add(chunk.len()) > MAX_EVIDENCE_BYTES {
                bail!("selected spreadsheet cells exceed the evidence limit");
            }
            bytes.extend_from_slice(&chunk);
        }
        verify_response(
            &bytes,
            &request,
            selection,
            self.organization_id,
            self.company_id,
        )
    }
}

fn verify_response(
    bytes: &[u8],
    request: &Value,
    selection: &SpreadsheetSelection,
    organization_id: u64,
    company_id: u64,
) -> Result<AuthorizedSelection> {
    let evidence: Value = serde_json::from_slice(bytes)?;
    if evidence["organizationId"] != organization_id.to_string()
        || evidence["companyId"] != company_id.to_string()
        || evidence["documentId"] != selection.document_id
        || evidence["versionId"] != selection.version_id
        || evidence["checksum"] != selection.checksum
        || evidence["sheetName"] != selection.sheet_name
        || evidence["firstRow"].as_u64() != Some(selection.first_row as u64)
        || evidence["lastRow"].as_u64() != Some(selection.last_row as u64)
        || evidence["firstColumn"].as_u64() != Some(selection.first_column as u64)
        || evidence["lastColumn"].as_u64() != Some(selection.last_column as u64)
        || evidence["delimiter"] != request["delimiter"]
        || evidence["encoding"] != request["encoding"]
        || evidence["headerRow"] != request["headerRow"]
        || !evidence["cells"].is_array()
        || !evidence["headings"].is_array()
    {
        bail!("spreadsheet evidence did not match the selection");
    }
    Ok(AuthorizedSelection {
        digest: hex::encode(Sha256::digest(bytes)),
        evidence,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request() -> Value {
        json!({
            "documentId": "9007199254740993", "versionId": "5", "current": false,
            "checksum": "c".repeat(64), "sheetName": "CSV",
            "firstRow": 4, "lastRow": 4, "firstColumn": 3, "lastColumn": 3,
            "delimiter": ";", "encoding": "utf-8", "headerRow": 1,
        })
    }

    #[test]
    fn spreadsheet_selector_cannot_supply_authoritative_cells() {
        let mut selector = request();
        assert!(serde_json::from_value::<SpreadsheetSelection>(selector.clone()).is_ok());
        selector["cells"] = json!([["forged"]]);
        assert!(serde_json::from_value::<SpreadsheetSelection>(selector).is_err());
    }

    #[test]
    fn spreadsheet_evidence_must_match_scope_and_exact_selection() {
        let request = request();
        let selection: SpreadsheetSelection = serde_json::from_value(request.clone()).unwrap();
        let verify = |response: &Value| {
            verify_response(
                &serde_json::to_vec(response).unwrap(),
                &request,
                &selection,
                7,
                3,
            )
        };
        let mut response = request.clone();
        response["organizationId"] = json!("7");
        response["companyId"] = json!("3");
        response["cells"] = json!([{ "row": 4, "column": 3, "value": "005" }]);
        response["headings"] = json!([]);
        let selected = verify(&response).unwrap();
        assert_eq!(
            selected.source().entity_id.as_deref(),
            Some("9007199254740993")
        );
        assert_eq!(selected.source().source_version.as_deref(), Some("5"));
        assert_eq!(selected.source().instruction_trust, "untrusted");

        for (key, value) in [
            ("companyId", json!("4")),
            ("versionId", json!("6")),
            ("lastColumn", json!(4)),
            ("delimiter", json!(",")),
        ] {
            let mut different = response.clone();
            different[key] = value;
            assert!(verify(&different).is_err(), "accepted altered {key}");
        }
        response["cells"][0]["value"] = json!("006");
        assert_ne!(verify(&response).unwrap().digest, selected.digest);
    }
}
