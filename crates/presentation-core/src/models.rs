use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// A draft module definition submitted for validation or publication.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModuleDraft {
    /// Schema revision for this wire model.
    pub schema_version: u32,
    /// Stable module identifier.
    pub module_id: String,
    /// Human-facing module title.
    pub title: String,
    /// Exact base revision targeted by an update, encoded as a decimal string.
    #[serde(default)]
    pub base_revision: Option<String>,
    /// Pinned application-contract release identifier.
    pub application_contract: String,
    /// Pinned component catalog revision.
    pub component_catalog_version: u32,
    /// Ordered pages in the module.
    pub pages: Vec<PageDefinition>,
}

/// A composed page and its ordered presentation nodes.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageDefinition {
    /// Stable page identifier.
    pub id: String,
    /// Human-facing page title.
    pub title: String,
    /// Ordered nodes rendered on the page.
    pub nodes: Vec<PageNode>,
}

/// A supported renderer-neutral page node.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum PageNode {
    /// A bounded entity collection/list.
    Collection(CollectionNode),
    /// A detail view linked to a source node.
    Detail(DetailNode),
}

/// A bounded collection/list node bound to an approved read resource.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollectionNode {
    /// Stable node identifier.
    pub id: String,
    /// Semantic host slot, independent of layout technology.
    pub slot: SemanticSlot,
    /// Approved component implementation and version.
    pub component: ComponentReference,
    /// Generated/approved read resource identifier.
    pub resource: String,
    /// SQL column identifiers exposed by the actor-filtered capability dictionary.
    pub fields: Vec<String>,
    /// Requested page size; execution must separately enforce bounded acquisition.
    pub page_size: u16,
}

/// A detail node linked to a selected collection node.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DetailNode {
    /// Stable node identifier.
    pub id: String,
    /// Semantic host slot, independent of layout technology.
    pub slot: SemanticSlot,
    /// Approved component implementation and version.
    pub component: ComponentReference,
    /// Stable ID of a collection node on the same page.
    pub source_node_id: String,
    /// SQL column identifiers exposed by the source capability dictionary.
    pub fields: Vec<String>,
}

/// Semantic placement slot understood by platform renderers.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SemanticSlot {
    /// Main page content.
    Primary,
    /// Supporting or detail content.
    Secondary,
}

/// Supported renderer-neutral component kinds.
#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ComponentKind {
    /// A bounded entity collection/list component.
    Collection,
    /// A detail component linked to a source node.
    Detail,
}

/// Versioned reference into the approved component catalog.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComponentReference {
    /// Stable catalog identifier.
    pub id: String,
    /// Exact compatible catalog version.
    pub version: u32,
}

/// Structured diagnostic returned by definition validation.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValidationDiagnostic {
    /// JSON-pointer-like path to the invalid value.
    pub path: String,
    /// Stable machine-readable diagnostic code.
    pub code: String,
    /// Human-readable diagnostic message.
    pub message: String,
}

/// Approved component metadata supplied to the pure validator.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovedComponentMetadata {
    /// Stable catalog identifier.
    pub id: String,
    /// Node kind implemented by this catalog entry.
    pub kind: ComponentKind,
    /// Catalog version.
    pub version: u32,
    /// Semantic slots accepted by the component.
    pub slots: Vec<SemanticSlot>,
}

/// Approved capability metadata supplied to the pure validator.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovedCapabilityMetadata {
    /// Generated/approved resource identifier.
    pub resource: String,
    /// Canonical field paths available from the resource.
    pub fields: Vec<String>,
}
