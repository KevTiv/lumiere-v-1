//! Optional presentation proposals accompanying an already-admitted RAG answer.
//!
//! The BFF supplies descriptors from the native TypeScript catalog. These are
//! presentation choices, never execution permissions or a second Rust registry.

use std::collections::HashSet;
use std::fmt;

use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};

use crate::harness::LiveSnapshot;

const MAX_OFFERS: usize = 128;
const MAX_PROPOSALS: usize = 5;
const MAX_WIDGET_OPTIONS: usize = 64;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UiActionKind {
    Navigate,
    OpenRecord,
    OpenForm,
    PrepareWorkflow,
    EditPage,
    AddWidget,
}

impl UiActionKind {
    fn needs_record(&self) -> bool {
        matches!(self, Self::OpenRecord | Self::PrepareWorkflow)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UiWidgetOffer {
    pub key: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UiActionOffer {
    pub capability_key: String,
    pub kind: UiActionKind,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub widgets: Vec<UiWidgetOffer>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UiActionProposal {
    pub capability_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub record_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub widget_key: Option<String>,
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value.as_bytes()[0].is_ascii_lowercase()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'.')
        })
}

fn widget_key(value: &str) -> bool {
    if let Some(id) = value.strip_prefix("saved:") {
        return record_id(id).is_some();
    }
    let Some(id) = value.strip_prefix("builtin:") else {
        return false;
    };
    !id.is_empty()
        && id.len() <= 160
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b':' | b'-'))
}

pub fn validate_offers(offers: &[UiActionOffer]) -> Result<(), &'static str> {
    if offers.len() > MAX_OFFERS {
        return Err("too many UI action offers");
    }
    let mut keys = HashSet::new();
    for offer in offers {
        if !identifier(&offer.capability_key)
            || !keys.insert(offer.capability_key.as_str())
            || offer.label.trim().is_empty()
            || offer.label.len() > 120
            || offer.label.chars().any(char::is_control)
            || offer
                .entity_type
                .as_deref()
                .is_some_and(|kind| !identifier(kind))
            || (offer.kind.needs_record() && offer.entity_type.is_none())
        {
            return Err("invalid UI action offer");
        }
        if offer.widgets.len() > MAX_WIDGET_OPTIONS
            || (!matches!(offer.kind, UiActionKind::AddWidget) && !offer.widgets.is_empty())
        {
            return Err("invalid widget choices");
        }
        let mut widget_keys = HashSet::new();
        for widget in &offer.widgets {
            if !widget_key(&widget.key)
                || !widget_keys.insert(widget.key.as_str())
                || widget.label.trim().is_empty()
                || widget.label.chars().count() > 120
                || widget.label.chars().any(char::is_control)
            {
                return Err("invalid widget choice");
            }
        }
    }
    Ok(())
}

pub fn offer_prompt(offers: &[UiActionOffer]) -> String {
    if offers.is_empty() {
        return String::new();
    }
    // All descriptors came from the BFF-owned catalog and were bounded above.
    let descriptors = serde_json::to_string(offers).unwrap_or_else(|_| "[]".to_string());
    format!(
        "\n\nThe answer JSON may additionally contain an optional ui_actions array with at most five presentation suggestions shaped as {{\"capability_key\":\"an offered key\",\"record_id\":\"an authorized decimal record id, only for record/workflow suggestions\"}}. Use only these offered descriptors: {descriptors}. A suggestion does not execute or save anything. Do not include URLs, field values, prompts, scopes, permissions or execution parameters. Record suggestions must reference the exact matching entity type and id in an authorized live snapshot. Omit record_id for navigate, open_form, edit_page and add_widget. Only add_widget may include widget_key, and only an exact key from that offer's widgets choices; omit widget_key to open the native widget composer. edit_page opens the current page editor, and add_widget stages a widget for review there. Never claim the page changed or a widget was saved before native confirmation and readback. Omit ui_actions when no offered action helps. Preserve all existing answer evidence and claim requirements."
    )
}

/// Parsing to Value normally collapses duplicate fields. Reject duplicates at
/// every depth first so presentation extraction cannot weaken the answer gate.
struct UniqueFields;

impl<'de> Deserialize<'de> for UniqueFields {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct UniqueVisitor;
        impl<'de> Visitor<'de> for UniqueVisitor {
            type Value = UniqueFields;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("JSON without duplicate fields")
            }

            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut keys = HashSet::new();
                while let Some(key) = map.next_key::<String>()? {
                    if !keys.insert(key) {
                        return Err(de::Error::custom("duplicate JSON field"));
                    }
                    map.next_value::<UniqueFields>()?;
                }
                Ok(UniqueFields)
            }

            fn visit_seq<S: SeqAccess<'de>>(
                self,
                mut sequence: S,
            ) -> Result<Self::Value, S::Error> {
                while sequence.next_element::<UniqueFields>()?.is_some() {}
                Ok(UniqueFields)
            }

            fn visit_str<E: de::Error>(self, _: &str) -> Result<Self::Value, E> {
                Ok(UniqueFields)
            }

            fn visit_bool<E: de::Error>(self, _: bool) -> Result<Self::Value, E> {
                Ok(UniqueFields)
            }

            fn visit_i64<E: de::Error>(self, _: i64) -> Result<Self::Value, E> {
                Ok(UniqueFields)
            }

            fn visit_u64<E: de::Error>(self, _: u64) -> Result<Self::Value, E> {
                Ok(UniqueFields)
            }

            fn visit_f64<E: de::Error>(self, _: f64) -> Result<Self::Value, E> {
                Ok(UniqueFields)
            }

            fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(UniqueFields)
            }
        }
        deserializer.deserialize_any(UniqueVisitor)
    }
}

/// Remove only the optional presentation member before the existing strict
/// answer parser. Every other unknown field still reaches that parser unchanged.
pub fn split_candidate(candidate: &str) -> (String, Vec<UiActionProposal>) {
    if serde_json::from_str::<UniqueFields>(candidate).is_err() {
        return (candidate.to_string(), Vec::new());
    }
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(candidate) else {
        return (candidate.to_string(), Vec::new());
    };
    let Some(object) = value.as_object_mut() else {
        return (candidate.to_string(), Vec::new());
    };
    let Some(actions) = object.remove("ui_actions") else {
        return (candidate.to_string(), Vec::new());
    };
    let proposals = serde_json::from_value::<Vec<UiActionProposal>>(actions)
        .ok()
        .filter(|actions| actions.len() <= MAX_PROPOSALS)
        .unwrap_or_default();
    (value.to_string(), proposals)
}

fn record_id(value: &str) -> Option<u64> {
    if value.is_empty() || value.len() > 20 || value.starts_with('0') {
        return None;
    }
    if !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    value.parse::<u64>().ok().filter(|id| *id > 0)
}

/// A model may select a known presentation action, but cannot invent a record
/// identity or smuggle an execution. Native UI reauthorizes again when opened.
pub fn release_proposals(
    proposals: Vec<UiActionProposal>,
    offers: &[UiActionOffer],
    snapshots: &[LiveSnapshot],
    answer_released: bool,
) -> Vec<UiActionProposal> {
    if !answer_released || proposals.len() > MAX_PROPOSALS || validate_offers(offers).is_err() {
        return Vec::new();
    }
    let mut seen = HashSet::new();
    for proposal in &proposals {
        let Some(offer) = offers
            .iter()
            .find(|offer| offer.capability_key == proposal.capability_key)
        else {
            return Vec::new();
        };
        if !seen.insert((
            &proposal.capability_key,
            &proposal.record_id,
            &proposal.widget_key,
        )) {
            return Vec::new();
        }
        if offer.kind.needs_record() {
            let Some(id) = proposal.record_id.as_deref().and_then(record_id) else {
                return Vec::new();
            };
            if !snapshots.iter().any(|snapshot| {
                Some(snapshot.entity_type.as_str()) == offer.entity_type.as_deref()
                    && snapshot.entity_id == id
            }) {
                return Vec::new();
            }
        } else if proposal.record_id.is_some() {
            return Vec::new();
        }
        if let Some(key) = &proposal.widget_key {
            if !matches!(offer.kind, UiActionKind::AddWidget)
                || !widget_key(key)
                || !offer.widgets.iter().any(|widget| widget.key == *key)
            {
                return Vec::new();
            }
        }
    }
    proposals
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn offers() -> Vec<UiActionOffer> {
        vec![
            UiActionOffer {
                capability_key: "sales.order.open".into(),
                kind: UiActionKind::OpenRecord,
                label: "Open sales order".into(),
                entity_type: Some("sale_order".into()),
                widgets: Vec::new(),
            },
            UiActionOffer {
                capability_key: "sales.order.create".into(),
                kind: UiActionKind::OpenForm,
                label: "Create sales order".into(),
                entity_type: Some("sale_order".into()),
                widgets: Vec::new(),
            },
            UiActionOffer {
                capability_key: "sales.navigate".into(),
                kind: UiActionKind::Navigate,
                label: "Open sales".into(),
                entity_type: None,
                widgets: Vec::new(),
            },
        ]
    }

    fn snapshots() -> Vec<LiveSnapshot> {
        vec![LiveSnapshot {
            entity_type: "sale_order".into(),
            entity_id: 9007199254740993,
            label: "Order".into(),
            snapshot_at: "now".into(),
            row: json!({}),
            relations: Vec::new(),
        }]
    }

    fn proposal(key: &str, id: Option<&str>) -> UiActionProposal {
        UiActionProposal {
            capability_key: key.into(),
            record_id: id.map(str::to_string),
            widget_key: None,
        }
    }

    #[test]
    fn offers_are_bounded_unique_and_have_no_arbitrary_fields() {
        assert!(validate_offers(&offers()).is_ok());
        let mut duplicate = offers();
        duplicate.push(duplicate[0].clone());
        assert!(validate_offers(&duplicate).is_err());
        assert!(validate_offers(&vec![offers()[0].clone(); MAX_OFFERS + 1]).is_err());
        for offer in [
            json!({ "capability_key": "sales.open", "kind": "execute", "label": "Open" }),
            json!({ "capability_key": "sales.open", "kind": "navigate", "label": "Open", "href": "/admin" }),
        ] {
            assert!(serde_json::from_value::<UiActionOffer>(offer).is_err());
        }
    }

    #[test]
    fn optional_actions_are_separated_without_weakening_answer_shape() {
        let candidate = json!({
            "content": "Answer", "claims": [], "calculations": [],
            "ui_actions": [{ "capability_key": "sales.navigate" }],
            "unknown": "still rejected by answer gate"
        })
        .to_string();
        let (answer, actions) = split_candidate(&candidate);
        let answer: serde_json::Value = serde_json::from_str(&answer).expect("answer JSON");
        assert!(answer.get("ui_actions").is_none());
        assert_eq!(answer["unknown"], "still rejected by answer gate");
        assert_eq!(actions, vec![proposal("sales.navigate", None)]);
    }

    #[test]
    fn duplicate_answer_fields_are_never_normalized_before_the_existing_gate() {
        for candidate in [
            r#"{"content":"first","content":"second","ui_actions":[]}"#,
            r#"{"content":"text","claims":[{"text":"first","text":"second"}],"ui_actions":[]}"#,
            r#"{"content":"text","ui_actions":[],"ui_actions":[]}"#,
        ] {
            let (answer, actions) = split_candidate(candidate);
            assert_eq!(answer, candidate);
            assert!(actions.is_empty());
        }
    }

    #[test]
    fn record_proposals_require_exact_authorized_entity_and_lossless_identity() {
        let action = proposal("sales.order.open", Some("9007199254740993"));
        assert_eq!(
            release_proposals(vec![action.clone()], &offers(), &snapshots(), true),
            vec![action]
        );
        for id in ["42", "0", "01", "-1", "1e3", "18446744073709551616"] {
            assert!(release_proposals(
                vec![proposal("sales.order.open", Some(id))],
                &offers(),
                &snapshots(),
                true
            )
            .is_empty());
        }
        let mut wrong_type = snapshots();
        wrong_type[0].entity_type = "purchase_order".into();
        assert!(release_proposals(
            vec![proposal("sales.order.open", Some("9007199254740993"))],
            &offers(),
            &wrong_type,
            true
        )
        .is_empty());
    }

    #[test]
    fn withheld_answers_unknown_keys_and_duplicate_actions_release_nothing() {
        let action = proposal("sales.navigate", None);
        assert!(release_proposals(vec![action.clone()], &offers(), &[], false).is_empty());
        assert!(
            release_proposals(vec![proposal("hidden.execute", None)], &offers(), &[], true)
                .is_empty()
        );
        assert!(release_proposals(vec![action.clone(), action], &offers(), &[], true).is_empty());
    }

    #[test]
    fn navigation_and_forms_carry_no_model_prefill_or_record_parameter() {
        assert_eq!(
            release_proposals(
                vec![proposal("sales.order.create", None)],
                &offers(),
                &[],
                true
            )
            .len(),
            1
        );
        assert!(release_proposals(
            vec![proposal("sales.order.create", Some("42"))],
            &offers(),
            &snapshots(),
            true
        )
        .is_empty());
        for extra in ["prompt", "params", "href", "scope", "field_values"] {
            let mut raw = json!({ "capability_key": "sales.order.create" });
            raw[extra] = json!("untrusted");
            let (_, actions) =
                split_candidate(&json!({ "content": "Answer", "ui_actions": [raw] }).to_string());
            assert!(actions.is_empty());
        }
    }

    #[test]
    fn malformed_or_excessive_action_metadata_is_optional_and_never_reaches_the_gate() {
        for actions in [
            json!(null),
            json!({}),
            json!([null]),
            json!(vec![proposal("sales.navigate", None); MAX_PROPOSALS + 1]),
        ] {
            let (answer, proposals) =
                split_candidate(&json!({ "content": "Answer", "ui_actions": actions }).to_string());
            assert!(proposals.is_empty());
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&answer).expect("answer JSON"),
                json!({ "content": "Answer" })
            );
        }
        assert!(offer_prompt(&[]).is_empty());
    }

    fn page_offers() -> Vec<UiActionOffer> {
        vec![
            UiActionOffer {
                capability_key: "sales.page.edit".into(),
                kind: UiActionKind::EditPage,
                label: "Edit sales page".into(),
                entity_type: None,
                widgets: Vec::new(),
            },
            UiActionOffer {
                capability_key: "sales.widget.add".into(),
                kind: UiActionKind::AddWidget,
                label: "Add widget to sales".into(),
                entity_type: None,
                widgets: vec![
                    UiWidgetOffer {
                        key: "saved:9007199254740993".into(),
                        label: "Orders by status".into(),
                    },
                    UiWidgetOffer {
                        key: "builtin:orders-kpi".into(),
                        label: "Order count".into(),
                    },
                ],
            },
        ]
    }

    #[test]
    fn page_composition_releases_only_offered_widget_choices_without_execution_parameters() {
        let (_, actions) = split_candidate(
            &json!({
                "content": "Review a widget for your page.",
                "ui_actions": [
                    { "capability_key": "sales.page.edit" },
                    { "capability_key": "sales.widget.add" },
                    { "capability_key": "sales.widget.add", "widget_key": "saved:9007199254740993" },
                    { "capability_key": "sales.widget.add", "widget_key": "builtin:orders-kpi" },
                ]
            })
            .to_string(),
        );
        assert_eq!(
            release_proposals(actions.clone(), &page_offers(), &[], true),
            actions
        );
        assert!(release_proposals(actions.clone(), &page_offers(), &[], false).is_empty());
        assert!(release_proposals(actions, &offers(), &[], true).is_empty());
        for raw in [
            json!({ "capability_key": "sales.widget.add", "widget_key": "saved:99" }),
            json!({ "capability_key": "sales.widget.add", "widget_key": "builtin:unoffered" }),
            json!({ "capability_key": "sales.widget.add", "widget_key": "saved:01" }),
            json!({ "capability_key": "sales.widget.add", "widget_key": "saved:18446744073709551616" }),
            json!({ "capability_key": "sales.page.edit", "widget_key": "saved:9007199254740993" }),
            json!({ "capability_key": "sales.widget.add", "record_id": "9007199254740993" }),
            json!({ "capability_key": "sales.widget.add", "page_id": "other" }),
            json!({ "capability_key": "sales.widget.add", "query": "SELECT * FROM account_move" }),
            json!({ "capability_key": "sales.widget.add", "params": {} }),
        ] {
            let (_, actions) =
                split_candidate(&json!({ "content": "Answer", "ui_actions": [raw] }).to_string());
            assert!(release_proposals(actions, &page_offers(), &[], true).is_empty());
        }
    }

    #[test]
    fn widget_offers_are_bounded_unique_and_available_only_to_add_widget() {
        assert!(validate_offers(&page_offers()).is_ok());
        for key in [
            "saved:0",
            "saved:01",
            "saved:18446744073709551616",
            "builtin:",
            "builtin:../admin",
            "https://example.com",
        ] {
            let mut offered = page_offers();
            offered[1].widgets[0].key = key.into();
            assert!(validate_offers(&offered).is_err(), "{key}");
        }
        let mut duplicate = page_offers();
        let repeated = duplicate[1].widgets[0].clone();
        duplicate[1].widgets.push(repeated);
        assert!(validate_offers(&duplicate).is_err());
        let mut wrong_kind = page_offers();
        wrong_kind[1].kind = UiActionKind::EditPage;
        assert!(validate_offers(&wrong_kind).is_err());
        let mut excessive = page_offers();
        excessive[1].widgets = (1..=MAX_WIDGET_OPTIONS + 1)
            .map(|id| UiWidgetOffer {
                key: format!("saved:{id}"),
                label: format!("Widget {id}"),
            })
            .collect();
        assert!(validate_offers(&excessive).is_err());
        let prompt = offer_prompt(&page_offers());
        assert!(prompt.contains("only an exact key"));
        assert!(prompt.contains("Never claim the page changed"));
    }
}
