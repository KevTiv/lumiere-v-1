//! Personal layout preferences for existing ERP pages.
//!
//! These values reference approved host widgets or saved dashboard widgets.
//! They contain no data, executable props, query text, or publication authority.

use std::{collections::HashSet, str::FromStr};

use schemars::{JsonSchema, Schema, SchemaGenerator};
use serde::{Deserialize, Serialize};

/// Reserved persistence namespace, disjoint from slug-only module drafts.
pub const PERSONAL_PAGE_NAMESPACE: &str = "personal-page:";
/// Versioned renderer contract stored with a personal layout snapshot.
pub const PERSONAL_PAGE_CONTRACT: &str = "lumiere.personal-page-layout/v1";
/// Bounded number of independent widget placements on one page.
pub const MAX_PERSONAL_PAGE_WIDGETS: usize = 64;
/// Maximum canonical snapshot size.
pub const MAX_PERSONAL_PAGE_BYTES: usize = 64 * 1024;

/// Existing business page hosts. Administration and AI debugger routes are excluded.
#[derive(Clone, Copy, Debug, Deserialize, JsonSchema, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PersonalPageModule {
    Overview,
    Accounting,
    Sales,
    Crm,
    Inventory,
    Products,
    Warehouse,
    Purchasing,
    Hr,
    Manufacturing,
    Projects,
    Iot,
    Documents,
    Calendar,
    Reports,
    Subscriptions,
    Expenses,
    Helpdesk,
    Workflows,
    Messages,
    Proposals,
    Pos,
    Fleet,
    Tasks,
    Approvals,
    Distributor,
    Map,
    Trackers,
}

impl PersonalPageModule {
    /// Canonical route identifier, shared with the generated client schema.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Overview => "overview",
            Self::Accounting => "accounting",
            Self::Sales => "sales",
            Self::Crm => "crm",
            Self::Inventory => "inventory",
            Self::Products => "products",
            Self::Warehouse => "warehouse",
            Self::Purchasing => "purchasing",
            Self::Hr => "hr",
            Self::Manufacturing => "manufacturing",
            Self::Projects => "projects",
            Self::Iot => "iot",
            Self::Documents => "documents",
            Self::Calendar => "calendar",
            Self::Reports => "reports",
            Self::Subscriptions => "subscriptions",
            Self::Expenses => "expenses",
            Self::Helpdesk => "helpdesk",
            Self::Workflows => "workflows",
            Self::Messages => "messages",
            Self::Proposals => "proposals",
            Self::Pos => "pos",
            Self::Fleet => "fleet",
            Self::Tasks => "tasks",
            Self::Approvals => "approvals",
            Self::Distributor => "distributor",
            Self::Map => "map",
            Self::Trackers => "trackers",
        }
    }

    /// Existing resource whose read permission admits this host's preferences.
    /// Widget data retains its own, independently enforced read permissions.
    pub fn permission_resource(self) -> &'static str {
        match self {
            Self::Overview => "dashboard:overview",
            Self::Tasks => "dashboard:tasks",
            Self::Trackers => "dashboard:analytics",
            Self::Accounting => "module:accounting",
            Self::Sales => "module:sales",
            Self::Crm => "module:crm",
            Self::Inventory | Self::Products | Self::Warehouse | Self::Distributor => {
                "module:inventory"
            }
            Self::Purchasing => "module:purchasing",
            Self::Hr => "module:hr",
            Self::Manufacturing => "module:manufacturing",
            Self::Projects => "module:projects",
            Self::Iot => "module:iot",
            Self::Documents => "module:documents",
            Self::Calendar => "module:calendar",
            Self::Reports => "module:reports",
            Self::Subscriptions => "module:subscriptions",
            Self::Expenses => "module:expenses",
            Self::Helpdesk => "module:helpdesk",
            Self::Workflows | Self::Approvals => "module:workflows",
            Self::Messages => "module:messages",
            Self::Proposals => "module:proposals",
            Self::Pos => "module:pos",
            Self::Fleet => "module:fleet",
            Self::Map => "module:map",
        }
    }
}

impl FromStr for PersonalPageModule {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        serde_json::from_value(serde_json::Value::String(value.to_owned()))
            .map_err(|_| "unsupported personal page module".to_string())
    }
}

/// Source of an inert widget reference; a reference never grants data access.
#[derive(Clone, Copy, Debug, Deserialize, JsonSchema, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PersonalPageWidgetSource {
    Builtin,
    Saved,
}

/// One independently sized placement. Array order is its visual order.
#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonalPageWidgetPlacement {
    /// Stable instance identifier, independent of the reusable widget identifier.
    #[schemars(length(min = 1, max = 128), regex(pattern = r"^[A-Za-z0-9_.:-]+$"))]
    pub id: String,
    pub source: PersonalPageWidgetSource,
    /// Host-owned builtin key (once per page), or reusable canonical positive decimal saved-widget ID.
    #[schemars(length(min = 1, max = 128), regex(pattern = r"^[A-Za-z0-9_.:-]+$"))]
    pub widget_id: String,
    /// Span in the host's twelve-column grid.
    #[schemars(schema_with = "width_schema")]
    pub width: u8,
}

fn width_schema(_: &mut SchemaGenerator) -> Schema {
    schemars::json_schema!({"type": "integer", "enum": [3, 4, 6, 8, 12]})
}

fn version_schema(_: &mut SchemaGenerator) -> Schema {
    schemars::json_schema!({"type": "integer", "const": 1})
}

fn nullable_revision_schema(_: &mut SchemaGenerator) -> Schema {
    schemars::json_schema!({"type": ["string", "null"]})
}

fn nullable_layout_schema(generator: &mut SchemaGenerator) -> Schema {
    generator.subschema_for::<Option<PersonalPageLayout>>()
}

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(deserializer)
}

/// Complete personal layout for one existing page.
#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonalPageLayout {
    #[schemars(schema_with = "version_schema")]
    pub schema_version: u32,
    pub module_id: PersonalPageModule,
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    )]
    pub page_id: String,
    #[schemars(length(max = MAX_PERSONAL_PAGE_WIDGETS))]
    pub widgets: Vec<PersonalPageWidgetPlacement>,
}

/// Save or reset intent. Actor, organization and company are not body authority.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavePersonalPageLayoutRequest {
    /// Null only when this personal page has never been saved.
    #[serde(deserialize_with = "required_nullable")]
    #[schemars(required, schema_with = "nullable_revision_schema")]
    pub expected_revision: Option<String>,
    /// Null appends a reset snapshot; it never erases revision history.
    #[serde(deserialize_with = "required_nullable")]
    #[schemars(required, schema_with = "nullable_layout_schema")]
    pub layout: Option<PersonalPageLayout>,
}

/// Exact saved revision, or an unsaved page's builtin default.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonalPageLayoutResponse {
    pub company_id: String,
    pub module_id: PersonalPageModule,
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    )]
    pub page_id: String,
    #[schemars(required, schema_with = "nullable_revision_schema")]
    pub revision: Option<String>,
    #[schemars(required, schema_with = "nullable_layout_schema")]
    pub layout: Option<PersonalPageLayout>,
}

/// Export catalog for generated clients, not an HTTP envelope.
#[derive(JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct PersonalPageLayoutContract {
    pub request: SavePersonalPageLayoutRequest,
    pub saved: PersonalPageLayoutResponse,
}

/// Canonical private snapshot stored in the existing presentation version table.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredPersonalPageLayout {
    pub schema_version: u32,
    pub company_id: String,
    pub module_id: PersonalPageModule,
    pub page_id: String,
    pub layout: Option<PersonalPageLayout>,
}

/// Structurally validated snapshot; callers must still authorize its references.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreparedPersonalPageLayout {
    pub module_key: String,
    pub definition_json: String,
    pub saved_widget_ids: Vec<u64>,
}

/// Parse a wire identity/revision without rounding, aliases, whitespace or signs.
pub fn personal_page_decimal(value: &str) -> Result<u64, String> {
    value
        .parse::<u64>()
        .ok()
        .filter(|id| *id > 0 && id.to_string() == value)
        .ok_or_else(|| "identity or revision must be a canonical positive decimal string".into())
}

/// Match the existing dashboard renderer's legacy model-name normalization.
/// Policy still resolves declared resource aliases and authorizes the resulting source.
pub fn personal_page_widget_source_resource(model: &str) -> String {
    model.trim().replace(['.', '-'], "_").to_ascii_lowercase()
}

/// Stable bounded page identifiers can represent overviews, dashboards or entity tabs.
pub fn validate_personal_page_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 64
        || value.starts_with('-')
        || value.ends_with('-')
        || value.contains("--")
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err("invalid personal page identifier".into());
    }
    Ok(())
}

fn valid_widget_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

/// Scope key for a private layout. This cannot be accepted as a generic draft slug.
pub fn personal_page_key(
    company_id: u64,
    module_id: PersonalPageModule,
    page_id: &str,
) -> Result<String, String> {
    if company_id == 0 {
        return Err("personal page company is required".into());
    }
    validate_personal_page_id(page_id)?;
    Ok(format!(
        "{PERSONAL_PAGE_NAMESPACE}{company_id}:{}:{page_id}",
        module_id.as_str()
    ))
}

/// Prepare a bounded, inert layout/reset without making any authorization decision.
pub fn prepare_personal_page_layout(
    company_id: u64,
    module_id: PersonalPageModule,
    page_id: &str,
    layout: Option<&PersonalPageLayout>,
) -> Result<PreparedPersonalPageLayout, String> {
    let module_key = personal_page_key(company_id, module_id, page_id)?;
    let mut saved_widget_ids = Vec::new();
    if let Some(layout) = layout {
        if layout.schema_version != 1 || layout.module_id != module_id || layout.page_id != page_id
        {
            return Err("personal page layout does not match its page or schema version".into());
        }
        if layout.widgets.len() > MAX_PERSONAL_PAGE_WIDGETS {
            return Err("personal page has too many widgets".into());
        }
        let mut instance_ids = HashSet::new();
        let mut builtin_ids = HashSet::new();
        for widget in &layout.widgets {
            if !valid_widget_key(&widget.id) || !instance_ids.insert(&widget.id) {
                return Err("personal page widget instances must have unique bounded IDs".into());
            }
            if !matches!(widget.width, 3 | 4 | 6 | 8 | 12) {
                return Err("personal page widget width must be 3, 4, 6, 8 or 12".into());
            }
            match widget.source {
                PersonalPageWidgetSource::Builtin => {
                    if !valid_widget_key(&widget.widget_id) {
                        return Err("invalid builtin widget reference".into());
                    }
                    if !builtin_ids.insert(&widget.widget_id) {
                        return Err("builtin widgets may appear only once per personal page".into());
                    }
                }
                PersonalPageWidgetSource::Saved => {
                    let id = personal_page_decimal(&widget.widget_id)?;
                    if !saved_widget_ids.contains(&id) {
                        saved_widget_ids.push(id);
                    }
                }
            }
        }
    }
    let stored = StoredPersonalPageLayout {
        schema_version: 1,
        company_id: company_id.to_string(),
        module_id,
        page_id: page_id.to_owned(),
        layout: layout.cloned(),
    };
    let definition_json = serde_json::to_string(&stored)
        .map_err(|error| format!("failed to encode personal page layout: {error}"))?;
    if definition_json.len() > MAX_PERSONAL_PAGE_BYTES {
        return Err("personal page layout exceeds size limit".into());
    }
    Ok(PreparedPersonalPageLayout {
        module_key,
        definition_json,
        saved_widget_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn layout() -> PersonalPageLayout {
        serde_json::from_value(json!({
            "schemaVersion": 1,
            "moduleId": "sales",
            "pageId": "dashboard",
            "widgets": [
                {"id":"revenue-a","source":"builtin","widgetId":"sales-revenue","width":8},
                {"id":"saved-a","source":"saved","widgetId":"18446744073709551615","width":4},
                {"id":"saved-b","source":"saved","widgetId":"18446744073709551615","width":12}
            ]
        }))
        .unwrap()
    }

    #[test]
    fn independent_placements_preserve_order_width_and_exact_ids() {
        let layout = layout();
        let prepared =
            prepare_personal_page_layout(7, PersonalPageModule::Sales, "dashboard", Some(&layout))
                .unwrap();
        assert_eq!(prepared.module_key, "personal-page:7:sales:dashboard");
        assert_eq!(prepared.saved_widget_ids, vec![u64::MAX]);
        let stored: StoredPersonalPageLayout =
            serde_json::from_str(&prepared.definition_json).unwrap();
        assert_eq!(stored.layout, Some(layout));
        assert_eq!(stored.company_id, "7");
        assert_eq!(
            prepare_personal_page_layout(
                7,
                stored.module_id,
                &stored.page_id,
                stored.layout.as_ref()
            )
            .unwrap(),
            prepared
        );
    }

    #[test]
    fn reset_remains_a_scoped_canonical_snapshot() {
        let reset =
            prepare_personal_page_layout(7, PersonalPageModule::Sales, "dashboard", None).unwrap();
        let stored: StoredPersonalPageLayout =
            serde_json::from_str(&reset.definition_json).unwrap();
        assert!(stored.layout.is_none());
        assert_eq!(stored.module_id, PersonalPageModule::Sales);
        assert!(reset.saved_widget_ids.is_empty());
        assert_ne!(
            reset.module_key,
            personal_page_key(8, PersonalPageModule::Sales, "dashboard").unwrap()
        );
    }

    #[test]
    fn save_requires_explicit_nullable_intent_and_revision() {
        for value in [
            json!({}),
            json!({"layout": null}),
            json!({"expectedRevision": null}),
        ] {
            assert!(serde_json::from_value::<SavePersonalPageLayoutRequest>(value).is_err());
        }
        let reset = serde_json::from_value::<SavePersonalPageLayoutRequest>(
            json!({"expectedRevision": null, "layout": null}),
        )
        .unwrap();
        assert!(reset.expected_revision.is_none() && reset.layout.is_none());
        assert_eq!(
            personal_page_widget_source_resource(" Sale.Order "),
            "sale_order"
        );
        assert_eq!(
            personal_page_widget_source_resource("account-moves"),
            "account_moves"
        );
    }

    #[test]
    fn rejects_ambiguous_ids_cross_page_layouts_and_executable_props() {
        for value in ["0", "01", "+1", " 1", "1.0", "1e3", "18446744073709551616"] {
            assert!(personal_page_decimal(value).is_err(), "{value}");
        }
        for value in ["", "../sales", "sales?x=1", "A", "-sales", "sales--detail"] {
            assert!(validate_personal_page_id(value).is_err(), "{value}");
        }
        for value in ["settings", "ai-harness", "admin", "Sales"] {
            assert!(value.parse::<PersonalPageModule>().is_err(), "{value}");
        }
        let mut value = serde_json::to_value(layout()).unwrap();
        value["widgets"][0]["callback"] = json!("javascript:run()");
        assert!(serde_json::from_value::<PersonalPageLayout>(value).is_err());
        assert!(prepare_personal_page_layout(
            7,
            PersonalPageModule::Accounting,
            "dashboard",
            Some(&layout())
        )
        .is_err());
        assert!(prepare_personal_page_layout(
            7,
            PersonalPageModule::Sales,
            "invoices",
            Some(&layout())
        )
        .is_err());
    }

    #[test]
    fn rejects_duplicates_invalid_spans_and_unbounded_layouts() {
        let mut candidate = layout();
        candidate.widgets[1].id = candidate.widgets[0].id.clone();
        assert!(prepare_personal_page_layout(
            7,
            PersonalPageModule::Sales,
            "dashboard",
            Some(&candidate)
        )
        .is_err());
        candidate = layout();
        let mut duplicate = candidate.widgets[0].clone();
        duplicate.id = "second-builtin-instance".into();
        candidate.widgets.push(duplicate);
        assert!(prepare_personal_page_layout(
            7,
            PersonalPageModule::Sales,
            "dashboard",
            Some(&candidate)
        )
        .is_err());
        candidate = layout();
        candidate.widgets[0].width = 5;
        assert!(prepare_personal_page_layout(
            7,
            PersonalPageModule::Sales,
            "dashboard",
            Some(&candidate)
        )
        .is_err());
        candidate = layout();
        candidate.widgets = (0..=MAX_PERSONAL_PAGE_WIDGETS)
            .map(|index| PersonalPageWidgetPlacement {
                id: format!("widget-{index}"),
                source: PersonalPageWidgetSource::Builtin,
                widget_id: "builtin".into(),
                width: 6,
            })
            .collect();
        assert!(prepare_personal_page_layout(
            7,
            PersonalPageModule::Sales,
            "dashboard",
            Some(&candidate)
        )
        .is_err());
    }
}
