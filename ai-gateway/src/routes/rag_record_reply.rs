//! Render only server-owned facts for exact record lookups.

use crate::harness::{entity_registry::lookup_entity_spec, snapshot::json_u64, LiveSnapshot};
use lumiere_finance_review_core::reviews::decimal;
use serde_json::Value;

const RELATION_DISPLAY_LIMIT: usize = 8;
const DECIMAL_SCALE: u32 = 9;
const DECIMAL_UNIT: i128 = 10_i128.pow(DECIMAL_SCALE);

pub(super) struct RecordFacts {
    pub facts: Vec<String>,
    pub limitations: Vec<String>,
}

pub(super) fn is_single_record_question(query: &str) -> bool {
    let query = query.to_ascii_lowercase();
    ![
        "compare ",
        "how many",
        " across ",
        "all records",
        "all entries",
        "what can you",
        "which records",
        "reporting period",
    ]
    .iter()
    .any(|phrase| query.contains(phrase))
}

pub(super) fn asks_for_contact_notes(query: &str, explicit_record: bool) -> bool {
    let query = query.trim().to_ascii_lowercase();
    let asks = ["summarize ", "show ", "what ", "read ", "quote ", "cite "]
        .iter()
        .any(|verb| query.starts_with(verb));
    let mentions_notes = query
        .split(|character: char| !character.is_alphanumeric())
        .any(|word| matches!(word, "notes" | "description"));
    asks && mentions_notes
        && (explicit_record || query.contains("selected contact"))
        && is_single_record_question(&query)
}

fn markdown_value(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut characters = compact.chars();
    let mut escaped = String::new();
    for character in characters.by_ref().take(160) {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '\\' | '`' | '*' | '_' | '[' | ']' | '~' | ':' | '!' => {
                escaped.push('\\');
                escaped.push(character);
            }
            _ => escaped.push(character),
        }
    }
    if characters.next().is_some() {
        escaped.push('…');
    }
    escaped
}

fn scalar(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.trim().is_empty() => Some(markdown_value(text)),
        Value::Number(_) | Value::Bool(_) => Some(value.to_string()),
        Value::Object(fields) => {
            if let Some(micros) = fields.get("microsSinceUnixEpoch") {
                let micros = micros.as_i64().or_else(|| micros.as_str()?.parse().ok())?;
                let timestamp = chrono::DateTime::from_timestamp_micros(micros)?;
                return Some(if micros.rem_euclid(86_400_000_000) == 0 {
                    timestamp.date_naive().to_string()
                } else {
                    timestamp.to_rfc3339()
                });
            }
            if let Some(value) = fields.get("some") {
                return match value {
                    Value::Array(values) if values.len() == 1 => scalar(&values[0]),
                    value => scalar(value),
                };
            }
            if let Some(tag) = fields.get("tag").and_then(Value::as_str) {
                return Some(markdown_value(tag));
            }
            if fields.len() == 1 {
                let (tag, value) = fields.iter().next()?;
                if tag != "none"
                    && (value.as_array().is_some_and(Vec::is_empty)
                        || value.as_object().is_some_and(serde_json::Map::is_empty))
                {
                    return Some(markdown_value(tag));
                }
            }
            None
        }
        _ => None,
    }
}

fn field_label(key: &str) -> String {
    let mut label = String::new();
    for (index, character) in key.chars().enumerate() {
        if index == 0 {
            label.push(character.to_ascii_uppercase());
        } else if character.is_ascii_uppercase() {
            label.push(' ');
            label.push(character.to_ascii_lowercase());
        } else if character == '_' {
            label.push(' ');
        } else {
            label.push(character);
        }
    }
    label
}

fn scalar_fields<'a>(row: &'a Value, skip: &'a [&str]) -> impl Iterator<Item = String> + 'a {
    row.as_object()
        .into_iter()
        .flatten()
        .filter_map(move |(key, value)| {
            if matches!(key.as_str(), "id" | "organizationId" | "companyId")
                || skip.contains(&key.as_str())
            {
                return None;
            }
            scalar(value).map(|text| format!("{}: {text}", field_label(key)))
        })
}

fn code(value: &Value) -> Option<&str> {
    value
        .as_str()
        .filter(|code| code.len() == 3 && code.bytes().all(|b| b.is_ascii_uppercase()))
}

fn decimal_units(value: &Value) -> Option<i128> {
    let (units, scale) = decimal(value).ok()?;
    units.checked_mul(10_i128.pow(DECIMAL_SCALE.checked_sub(scale)?))
}

fn money(units: i128, code: Option<&str>) -> String {
    let absolute = units.unsigned_abs();
    let divisor = DECIMAL_UNIT as u128;
    let fraction = format!("{:09}", absolute % divisor);
    let fraction = fraction.trim_end_matches('0');
    let sign = if units < 0 { "-" } else { "" };
    let suffix = if fraction.is_empty() {
        String::new()
    } else {
        format!(".{fraction}")
    };
    let amount = format!("{sign}{}{suffix}", absolute / divisor);
    match code {
        Some(code) => format!("{code} {amount}"),
        None => amount,
    }
}

fn same_id(first: &Value, second: &Value) -> bool {
    json_u64(Some(first)).is_some_and(|first| first > 0 && json_u64(Some(second)) == Some(first))
}

fn journal_total(lines: &[Value], expected_currency: Option<&Value>) -> Option<i128> {
    let currency = &lines.first()?["companyCurrencyId"];
    if expected_currency.is_some_and(|expected| !same_id(expected, currency)) {
        return None;
    }
    let (debits, credits) =
        lines
            .iter()
            .try_fold((0_i128, 0_i128), |(debits, credits), line| {
                if !same_id(currency, &line["companyCurrencyId"]) {
                    return None;
                }
                let debit = decimal_units(&line["debit"]).filter(|value| *value >= 0)?;
                let credit = decimal_units(&line["credit"]).filter(|value| *value >= 0)?;
                Some((debits.checked_add(debit)?, credits.checked_add(credit)?))
            })?;
    (debits == credits).then_some(debits)
}

fn journal_facts(snapshot: &LiveSnapshot, output: &mut RecordFacts) {
    let row = &snapshot.row;
    let lines = snapshot
        .relations
        .iter()
        .find(|relation| relation.relation_key == "lines");
    let move_type = scalar(&row["moveType"]).map(|kind| kind.to_ascii_lowercase());
    let first_line = lines.and_then(|lines| lines.rows.first());
    let currency = code(&row["companyCurrencyCode"]).or_else(|| {
        let line = lines?.rows.first()?;
        code(&line["companyCurrencyCode"]).or_else(|| {
            same_id(&line["companyCurrencyId"], &row["currencyId"])
                .then(|| code(&row["currencyCode"]))
                .flatten()
        })
    });

    let is_document = matches!(
        move_type.as_deref(),
        Some("outinvoice" | "outrefund" | "ininvoice" | "inrefund" | "outreceipt" | "inreceipt")
    );
    let total = if is_document {
        decimal_units(&row["amountTotal"])
    } else {
        lines.and_then(|lines| journal_total(&lines.rows, row.get("companyCurrencyId")))
    };
    if let Some(total) = total {
        let total_currency = if is_document {
            code(&row["currencyCode"])
        } else {
            currency
        };
        output
            .facts
            .push(format!("Total: {}", money(total, total_currency)));
        if total_currency.is_none() {
            output
                .limitations
                .push("The total's currency code is unavailable.".into());
        }
    } else {
        output
            .limitations
            .push("The total could not be verified from the available journal data.".into());
    }
    for line in lines
        .into_iter()
        .flat_map(|lines| &lines.rows)
        .take(RELATION_DISPLAY_LIMIT)
    {
        for (field, direction) in [("debit", "Debit"), ("credit", "Credit")] {
            let Some(units) = decimal_units(&line[field]).filter(|units| *units > 0) else {
                continue;
            };
            let line_currency = code(&line["companyCurrencyCode"])
                .or_else(|| {
                    same_id(&line["companyCurrencyId"], &row["companyCurrencyId"])
                        .then(|| code(&row["companyCurrencyCode"]))
                        .flatten()
                })
                .or_else(|| {
                    first_line
                        .filter(|first| {
                            same_id(&line["companyCurrencyId"], &first["companyCurrencyId"])
                        })
                        .and_then(|first| code(&first["companyCurrencyCode"]))
                })
                .or_else(|| {
                    same_id(&line["companyCurrencyId"], &row["currencyId"])
                        .then(|| code(&row["currencyCode"]))
                        .flatten()
                });
            let amount = money(units, line_currency);
            let account = scalar(&line["accountName"]).or_else(|| scalar(&line["accountCode"]));
            if let Some(account) = account {
                output
                    .facts
                    .push(format!("{direction} account: {account} · {amount}"));
            } else if let Some(account_id) = scalar(&line["accountId"]) {
                output
                    .facts
                    .push(format!("{direction} account ID: {account_id} · {amount}"));
            } else {
                output.facts.push(format!("{direction}: {amount}"));
            }
        }
    }
    output.facts.extend(scalar_fields(
        row,
        &[
            "amountTotal",
            "currencyCode",
            "companyCurrencyCode",
            "currencyId",
            "companyCurrencyId",
        ],
    ));
}

pub(super) fn record_facts(snapshot: &LiveSnapshot) -> RecordFacts {
    let mut output = RecordFacts {
        facts: Vec::new(),
        limitations: Vec::new(),
    };
    if snapshot.entity_type == "account_move" {
        journal_facts(snapshot, &mut output);
    } else {
        output.facts.extend(scalar_fields(&snapshot.row, &[]));
    }
    if let Some(spec) = lookup_entity_spec(&snapshot.entity_type) {
        for relation in spec.relations {
            let label = field_label(relation.relation_key);
            let Some(relation) = snapshot
                .relations
                .iter()
                .find(|rows| rows.relation_key == relation.relation_key)
            else {
                output.limitations.push(format!(
                    "{label} could not be verified within the available record scope."
                ));
                continue;
            };
            if snapshot.entity_type != "account_move" {
                for (index, row) in relation
                    .rows
                    .iter()
                    .take(RELATION_DISPLAY_LIMIT)
                    .enumerate()
                {
                    let details = scalar_fields(row, &[]).collect::<Vec<_>>().join(" · ");
                    if !details.is_empty() {
                        output
                            .facts
                            .push(format!("{label} {}: {details}", index + 1));
                    }
                }
            }
            if relation.rows.len() > RELATION_DISPLAY_LIMIT {
                output.limitations.push(format!(
                    "{label} are shown for the first {RELATION_DISPLAY_LIMIT} of {} rows.",
                    relation.rows.len()
                ));
            }
        }
    }
    if output.facts.is_empty() {
        output
            .limitations
            .push("Record details are unavailable for this account.".into());
    }
    output
}

pub(super) fn contact_note_facts(snapshot: &LiveSnapshot) -> RecordFacts {
    match scalar(&snapshot.row["description"]) {
        Some(note) => RecordFacts {
            facts: vec![format!("Saved notes: {note}")],
            limitations: Vec::new(),
        },
        None => RecordFacts {
            facts: Vec::new(),
            limitations: vec!["No saved notes are available for this contact.".into()],
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::snapshot::RelationSnapshot;
    use serde_json::json;

    #[test]
    fn selected_contact_notes_render_as_exact_saved_text() {
        assert!(asks_for_contact_notes(
            "Summarize the saved notes on the selected contact. What is the source?",
            false,
        ));
        assert!(asks_for_contact_notes("What do the notes say?", true));
        assert!(!asks_for_contact_notes("What do the notes say?", false));
        assert!(!asks_for_contact_notes("Do not show the notes.", true));
        assert!(!asks_for_contact_notes("Compare the notes across contacts", true));
        let mut contact = LiveSnapshot {
            entity_type: "contact".into(),
            entity_id: 42,
            label: "Contact #42".into(),
            snapshot_at: "2026-11-20T20:00:00Z".into(),
            row: json!({"description": "Source is row 22. Current status is unconfirmed."}),
            relations: Vec::new(),
        };
        let result = contact_note_facts(&contact);
        assert_eq!(
            result.facts,
            ["Saved notes: Source is row 22. Current status is unconfirmed."]
        );
        assert!(result.limitations.is_empty());
        contact.row = json!({});
        let result = contact_note_facts(&contact);
        assert!(result.facts.is_empty());
        assert!(!result.limitations.is_empty());
    }

    fn entry() -> LiveSnapshot {
        LiveSnapshot {
            entity_type: "account_move".into(),
            entity_id: 9,
            label: "Journal entry #9".into(),
            snapshot_at: "2026-11-17T20:00:00Z".into(),
            row: json!({"moveType": {"Entry": []}, "amountTotal": 0, "companyCurrencyId": 8, "companyCurrencyCode": "RWF"}),
            relations: vec![RelationSnapshot {
                relation_key: "lines".into(),
                rows: vec![
                    json!({"companyCurrencyId": "8", "debit": "600.00", "credit": 0, "accountName": "Electricity expense"}),
                    json!({"companyCurrencyId": 8, "debit": 0, "credit": 600, "accountName": "Source import clearing"}),
                ],
            }],
        }
    }

    #[test]
    fn computes_entry_total_from_balanced_lines_and_names_debit_account() {
        let facts = record_facts(&entry());
        assert!(facts.facts.contains(&"Total: RWF 600".into()));
        assert!(facts
            .facts
            .contains(&"Debit account: Electricity expense · RWF 600".into()));
        assert!(facts.limitations.is_empty());
    }

    #[test]
    fn omits_total_on_missing_unbalanced_or_mixed_currency_lines() {
        let mut original = entry();
        original.relations[0].rows[1]["credit"] = json!(601);
        assert!(!record_facts(&original)
            .facts
            .iter()
            .any(|fact| fact.starts_with("Total:")));
        original.relations[0].rows[1]["credit"] = json!(600);
        original.relations[0].rows[1]["companyCurrencyId"] = json!(10);
        let mixed = record_facts(&original);
        assert!(!mixed.facts.iter().any(|fact| fact.starts_with("Total:")));
        assert!(mixed
            .facts
            .contains(&"Credit account: Source import clearing · 600".into()));
        original.relations.clear();
        assert!(!record_facts(&original)
            .facts
            .iter()
            .any(|fact| fact.starts_with("Total:")));
    }

    #[test]
    fn redacted_kind_does_not_establish_a_header_total_and_dates_render_from_wire_values() {
        let mut original = entry();
        original.row["moveType"] = Value::Null;
        original.row["date"] = json!({"microsSinceUnixEpoch": "1712620800000000"});
        original.relations.clear();
        let facts = record_facts(&original);
        assert!(facts.facts.contains(&"Date: 2024-04-09".into()));
        assert!(!facts.facts.iter().any(|fact| fact.starts_with("Total:")));
    }
}
