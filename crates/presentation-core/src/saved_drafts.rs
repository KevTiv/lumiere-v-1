//! Owner-scoped saved draft HTTP contracts; saving grants no execution authority.

use crate::ModuleDraft;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Export catalog for generated schemas, not an HTTP envelope.
#[derive(JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct SavedDraftContract {
    /// Save input.
    pub request: SaveDraftRequest,
    /// Complete saved snapshot.
    pub saved: SavedDraft,
    /// Bounded list of personal module heads.
    pub list: SavedDraftList,
}

/// Untrusted save intent; organization and actor come from the session.
#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveDraftRequest {
    /// Canonical positive decimal revision, or null for a new module.
    pub expected_revision: Option<String>,
    /// Complete definition, validated against the current actor's catalog.
    pub definition: ModuleDraft,
}

/// Complete immutable snapshot, prepared for editing at its saved revision.
#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedDraft {
    /// Stable module slug within the personal organization scope.
    pub module_key: String,
    /// Canonical positive decimal revision.
    pub revision: String,
    /// Lowercase SHA-256 hex of canonical persisted JSON, before edit revision insertion.
    pub definition_hash: String,
    /// Complete definition with baseRevision set to revision for editing.
    pub definition: ModuleDraft,
}

/// Personal module head summary; never includes another actor's module.
#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedDraftSummary {
    /// Stable module slug.
    pub module_key: String,
    /// Current snapshot's title.
    pub title: String,
    /// Canonical positive decimal revision.
    pub revision: String,
}

/// All personal heads, bounded by the database's per-owner module limit.
#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedDraftList {
    /// Summaries of the current actor's saved modules.
    pub drafts: Vec<SavedDraftSummary>,
}
