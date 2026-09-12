//! Read-only preview transport. These values confer no publication authority.

use crate::ModuleDraft;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Schema catalog used by the contract exporter, not an HTTP envelope.
#[derive(JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct PreviewContract {
    /// Actor-filtered choices for the read-only composer.
    pub options: PreviewOptions,
    /// Input to preview acquisition.
    pub request: PreviewRequest,
    /// Validated definition and bounded display data.
    pub response: PreviewResponse,
}

/// Actor-filtered choices; acquisition reauthorizes every request.
#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewOptions {
    /// Currently approved application contract pin.
    pub application_contract: String,
    /// Fields available to this actor for the pilot resource.
    pub fields: Vec<String>,
}

/// A complete draft plus the selected company.
#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewRequest {
    /// Untrusted draft, validated before any acquisition.
    pub definition: ModuleDraft,
    /// Decimal company ID; membership is resolved on the server.
    pub company_id: String,
}

/// Read-only preview result; not a published or persisted definition.
#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewResponse {
    /// Definition successfully validated for the current actor.
    pub definition: ModuleDraft,
    /// Bounded data for its collection nodes.
    pub collections: Vec<PreviewCollection>,
}

/// A bounded collection page, identified without a second placement model.
#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewCollection {
    /// Owning page.
    pub page_id: String,
    /// Owning collection node.
    pub node_id: String,
    /// Rows from the authorized bounded acquisition.
    pub rows: Vec<PreviewRow>,
    /// True when an extra fetched row proves the preview is incomplete.
    pub truncated: bool,
}

/// Display projection of a row; IDs retain full integer precision.
#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewRow {
    /// Decimal entity ID.
    pub id: String,
    /// Actor-approved collection and linked detail fields.
    pub fields: Vec<PreviewField>,
}

/// Text value resolved using canonical SQL-to-DTO metadata on the server.
#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewField {
    /// Canonical dictionary field ID.
    pub field: String,
    /// Escaped as ordinary text by renderers; null indicates no value.
    pub value: Option<String>,
}
