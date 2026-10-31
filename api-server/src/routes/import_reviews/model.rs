use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum FieldKind {
    Text,
    Decimal,
    Date,
    Choice,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct ReviewField {
    pub key: String,
    pub label: String,
    pub kind: FieldKind,
    pub source_value: Option<String>,
    pub required: bool,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default = "yes")]
    pub export: bool,
}
fn yes() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct SourceReference {
    pub file: String,
    pub row: u32,
    pub sha256: String,
    #[serde(default)]
    pub row_basis: RowBasis,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum RowBasis {
    #[default]
    SourceLine,
    ImportRow,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct ReviewItem {
    pub key: String,
    pub label: String,
    pub source: SourceReference,
    pub issue: String,
    pub fields: Vec<ReviewField>,
    pub proposed: BTreeMap<String, Option<String>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct Dataset {
    pub format: String,
    pub title: String,
    pub target_entity: String,
    pub source_file: String,
    pub items: Vec<ReviewItem>,
}

pub(super) fn sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn key(value: &str) -> bool {
    value
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_alphabetic)
        && value.len() <= 100
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
}

fn field_key(value: &str) -> bool {
    key(value)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        && !matches!(value, "constructor" | "prototype")
}

/// Exact fixed-point validation for review values, with no floating-point coercion.
pub(super) fn decimal(value: &str) -> Option<i128> {
    let unsigned = value.strip_prefix('-').unwrap_or(value);
    let (whole, fraction) = unsigned.split_once('.').unwrap_or((unsigned, ""));
    if whole.is_empty()
        || whole.len() > 12
        || fraction.len() > 6
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || !fraction.bytes().all(|b| b.is_ascii_digit())
        || (unsigned.contains('.') && fraction.is_empty())
    {
        return None;
    }
    let scale = 1_000_000i128;
    let base = whole.parse::<i128>().ok()?.checked_mul(scale)?;
    let fractional = if fraction.is_empty() {
        0
    } else {
        fraction
            .parse::<i128>()
            .ok()?
            .checked_mul(10i128.pow(6 - fraction.len() as u32))?
    };
    let result = base.checked_add(fractional)?;
    Some(if value.starts_with('-') {
        -result
    } else {
        result
    })
}

pub(super) fn validate_values(
    item: &ReviewItem,
    values: &BTreeMap<String, Option<String>>,
    state: &str,
    reason: &str,
) -> Result<(), String> {
    if !matches!(state, "needs_review" | "confirmed" | "excluded") {
        return Err("invalid review state".into());
    }
    if reason.len() > 2000 || (state != "needs_review" && reason.trim().len() < 3) {
        return Err("enter a reason for this decision".into());
    }
    if values
        .keys()
        .any(|key| !item.fields.iter().any(|field| &field.key == key))
    {
        return Err("unknown correction field".into());
    }
    for field in &item.fields {
        let value = values
            .get(&field.key)
            .and_then(Option::as_deref)
            .unwrap_or("");
        if value.is_empty() {
            if state == "confirmed" && field.required {
                return Err(format!("{} is required before confirmation", field.label));
            }
            continue;
        }
        if value.len() > 2000 {
            return Err("a correction value is too long".into());
        }
        let valid = match field.kind {
            FieldKind::Text => true,
            FieldKind::Decimal => decimal(value).is_some(),
            FieldKind::Date => chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .is_ok_and(|date| date.format("%Y-%m-%d").to_string() == value),
            FieldKind::Choice => field.options.iter().any(|option| option == value),
        };
        if !valid {
            return Err(format!("{} has an invalid value", field.label));
        }
    }
    if state == "confirmed" {
        let number = |key: &str| values.get(key).and_then(Option::as_deref).and_then(decimal);
        if let (Some(quantity), Some(price), Some(amount)) =
            (number("quantity"), number("unit_price"), number("amount"))
        {
            if !quantity
                .checked_mul(price)
                .zip(amount.checked_mul(1_000_000))
                .is_some_and(|(computed, declared)| computed == declared)
            {
                return Err(
                    "quantity multiplied by unit price must equal the proposed amount".into(),
                );
            }
        }
    }
    Ok(())
}

/// Confirming one value does not resolve unrelated missing facts or change units.
pub(super) fn validate_confirmed_fields(
    item: &ReviewItem,
    values: &BTreeMap<String, Option<String>>,
    confirmed_fields: &BTreeSet<String>,
    state: &str,
    reason: &str,
) -> Result<(), String> {
    if !confirmed_fields.is_empty() && reason.trim().len() < 3 {
        return Err("enter supporting evidence for the confirmed values".into());
    }
    for key in confirmed_fields {
        if !item.fields.iter().any(|field| &field.key == key)
            || !values
                .get(key)
                .and_then(Option::as_deref)
                .is_some_and(|value| !value.trim().is_empty())
        {
            return Err("only known, nonempty values can be confirmed".into());
        }
    }
    if state == "confirmed" {
        for field in &item.fields {
            let populated = values
                .get(&field.key)
                .and_then(Option::as_deref)
                .is_some_and(|value| !value.trim().is_empty());
            if (field.required || populated) && !confirmed_fields.contains(&field.key) {
                return Err(format!(
                    "{} needs confirmation before the row can continue",
                    field.label
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn validate_dataset(data: &Dataset) -> Result<(), String> {
    if data.format != "lumiere-import-review/v1"
        || data.title.trim().is_empty()
        || data.title.len() > 200
        || data.source_file.is_empty()
        || data.source_file.len() > 300
    {
        return Err("invalid source review document".into());
    }
    if !matches!(
        data.target_entity.as_str(),
        "product" | "account_move" | "stock_location" | "contact" | "source_observation"
    ) {
        return Err("unsupported review target".into());
    }
    if data.items.is_empty() || data.items.len() > 1000 {
        return Err("a review document must contain 1 to 1000 items".into());
    }
    let mut keys = BTreeSet::new();
    for item in &data.items {
        if !key(&item.key)
            || !keys.insert(&item.key)
            || item.label.trim().is_empty()
            || item.label.len() > 300
            || item.issue.trim().is_empty()
            || item.issue.len() > 2000
            || item.source.file.is_empty()
            || item.source.file.len() > 300
            || item.source.row == 0
            || !sha256(&item.source.sha256)
            || item.fields.is_empty()
            || item.fields.len() > 32
        {
            return Err("invalid review item or source reference".into());
        }
        let mut field_keys = BTreeSet::new();
        for field in &item.fields {
            if !field_key(&field.key)
                || !field_keys.insert(&field.key)
                || field.label.is_empty()
                || field.label.len() > 200
                || field.source_value.as_ref().is_some_and(|s| s.len() > 2000)
                || field.options.len() > 40
                || field.options.iter().any(|v| v.is_empty() || v.len() > 200)
                || (field.kind == FieldKind::Choice && field.options.is_empty())
            {
                return Err("invalid correction field".into());
            }
        }
        validate_values(item, &item.proposed, "needs_review", "")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decimal_values_are_exact_and_bounded() {
        assert_eq!(decimal("0.008"), Some(8000));
        assert_eq!(decimal("600000"), Some(600000000000));
        for invalid in [
            "NaN",
            "Infinity",
            "1e3",
            "",
            "1.",
            ".8",
            "1.0000001",
            "1234567890123",
            " 8",
        ] {
            assert_eq!(decimal(invalid), None, "{invalid}");
        }
    }
    #[test]
    fn uncertain_rows_can_be_saved_but_not_confirmed_with_missing_values() {
        let item:ReviewItem=serde_json::from_value(serde_json::json!({"key":"sausage","label":"Sausage","source":{"file":"shop.csv","row":2,"sha256":"a".repeat(64)},"issue":"Weight is unknown","fields":[{"key":"quantity","label":"Weight (kg)","kind":"decimal","sourceValue":"8","required":true}],"proposed":{"quantity":null}})).unwrap();
        assert!(validate_values(&item, &item.proposed, "needs_review", "").is_ok());
        assert!(validate_values(&item, &item.proposed, "confirmed", "Confirmed weight").is_err());
        let values = BTreeMap::from([("quantity".into(), Some("1".into()))]);
        assert!(validate_values(&item, &values, "confirmed", "Confirmed weight").is_ok());
        assert!(validate_values(&item, &values, "confirmed", "").is_err());
    }

    #[test]
    fn price_confirmation_keeps_unknown_weight_and_cost_unresolved() {
        let item: ReviewItem = serde_json::from_value(serde_json::json!({
            "key":"sausage", "label":"Sausage", "source":{"file":"shop.csv","row":8,"sha256":"a".repeat(64)},
            "issue":"Weight, original unit and cost unknown", "fields":[
                {"key":"quantity","label":"Actual weight","kind":"decimal","sourceValue":"8","required":true},
                {"key":"unit_price","label":"Price per kg","kind":"decimal","sourceValue":"600","required":true},
                {"key":"cost_price","label":"Cost","kind":"decimal","sourceValue":null,"required":true},
                {"key":"stored_unit","label":"Price unit","kind":"choice","options":["kg","unit"],"sourceValue":null,"required":true}
            ], "proposed":{"quantity":null,"unit_price":"4800","cost_price":null,"stored_unit":"kg"}
        })).unwrap();
        let fields = BTreeSet::from(["unit_price".into(), "stored_unit".into()]);
        assert!(validate_values(
            &item,
            &item.proposed,
            "needs_review",
            "Price confirmed; weight unknown"
        )
        .is_ok());
        assert!(validate_confirmed_fields(
            &item,
            &item.proposed,
            &fields,
            "needs_review",
            "Price confirmed; weight unknown"
        )
        .is_ok());
        assert!(validate_values(&item, &item.proposed, "confirmed", "Price confirmed").is_err());
        assert!(validate_confirmed_fields(
            &item,
            &item.proposed,
            &BTreeSet::from(["quantity".into()]),
            "needs_review",
            "Unknown"
        )
        .is_err());
        assert_eq!(item.proposed.get("quantity"), Some(&None));
        assert_eq!(item.fields[0].source_value.as_deref(), Some("8"));
    }

    #[test]
    fn a_complete_row_cannot_export_an_unconfirmed_optional_proposal() {
        let item: ReviewItem = serde_json::from_value(serde_json::json!({
            "key":"source", "label":"Source", "source":{"file":"shop.csv","row":2,"sha256":"a".repeat(64)},
            "issue":"Optional location proposed", "fields":[
                {"key":"name","label":"Name","kind":"text","sourceValue":"Shop","required":true},
                {"key":"location","label":"Location","kind":"text","sourceValue":null,"required":false}
            ], "proposed":{"name":"Shop","location":"North store"}
        })).unwrap();
        let only_name = BTreeSet::from(["name".into()]);
        assert!(validate_confirmed_fields(
            &item,
            &item.proposed,
            &only_name,
            "confirmed",
            "Name verified"
        )
        .is_err());
        assert!(validate_confirmed_fields(
            &item,
            &item.proposed,
            &only_name,
            "needs_review",
            "Name verified"
        )
        .is_ok());
    }
}
