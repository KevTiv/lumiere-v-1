//! Find specific ERP records without depending on semantic search results.

use std::time::Duration;

use anyhow::{ensure, Context, Result};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::{
    entity_registry::lookup_entity_spec,
    snapshot::{ActorCredentials, EntityRef},
};
use crate::state::AppState;

#[derive(Debug, PartialEq)]
pub(crate) enum RecordLookup {
    NotRequested,
    NotFound,
    Match(EntityRef),
    Ambiguous,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct RecordKind {
    entity_type: &'static str,
    move_kind: Option<&'static str>,
}

const fn kind(entity_type: &'static str) -> RecordKind {
    RecordKind {
        entity_type,
        move_kind: None,
    }
}

const fn account_move(move_kind: &'static str) -> RecordKind {
    RecordKind {
        entity_type: "account_move",
        move_kind: Some(move_kind),
    }
}

const ALIASES: &[(&str, RecordKind)] = &[
    ("journal entry", account_move("journal_entry")),
    ("vendor bill", account_move("vendor_bill")),
    ("customer invoice", account_move("invoice")),
    ("invoice", account_move("invoice")),
    ("bill", account_move("vendor_bill")),
    ("payment", kind("account_payment")),
    ("sales order", kind("sale_order")),
    ("sale order", kind("sale_order")),
    ("purchase order", kind("purchase_order")),
    ("expense report", kind("expense_sheet")),
    ("expense", kind("hr_expense")),
    ("stock transfer", kind("stock_picking")),
    ("warehouse transfer", kind("stock_picking")),
    ("cycle count", kind("stock_cycle_count")),
    ("stock location", kind("stock_location")),
    ("warehouse location", kind("stock_location")),
    ("fleet vehicle", kind("fleet_vehicle")),
    ("vehicle", kind("fleet_vehicle")),
    ("fleet inspection", kind("fleet_inspection")),
    ("fleet service record", kind("fleet_service_record")),
    ("product", kind("product")),
    ("contact", kind("contact")),
    ("customer", kind("contact")),
    ("supplier", kind("contact")),
    ("lead", kind("lead")),
    ("opportunity", kind("opportunity")),
    ("subscription", kind("subscription")),
    ("project task", kind("project_task")),
    ("task", kind("project_task")),
    ("manufacturing order", kind("mrp_production")),
];

#[derive(Debug, PartialEq, Eq)]
enum Locator {
    Id {
        id: u64,
        date: Option<NaiveDate>,
        posted: bool,
    },
    Label {
        label: Option<String>,
        date: Option<NaiveDate>,
        posted: bool,
    },
}

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

fn phrase(text: &str, term: &str) -> Option<usize> {
    text.match_indices(term)
        .find(|&(index, _)| {
            !text[..index].chars().next_back().is_some_and(is_word)
                && !text[index + term.len()..]
                    .chars()
                    .next()
                    .is_some_and(is_word)
        })
        .map(|(index, _)| index)
}

fn primary_clause(query: &str) -> &str {
    query.split(['?', ';', '\n']).next().unwrap_or_default()
}

/// Find supported record references. Longer compound names take precedence
/// over their generic components, including "expense journal entry".
fn identify(query: &str, ui_module: Option<&str>) -> Option<(RecordKind, usize, usize)> {
    // ASCII normalization preserves byte positions for names such as Élodie.
    let normalized = query.to_ascii_lowercase();
    let kinds = ALIASES.iter().copied().chain(match ui_module {
        Some("sales") => Some(("order", kind("sale_order"))),
        Some("purchasing") => Some(("order", kind("purchase_order"))),
        Some("accounting") => Some(("entry", account_move("journal_entry"))),
        Some("warehouse") | Some("inventory") => Some(("transfer", kind("stock_picking"))),
        _ => None,
    });
    kinds
        .filter_map(|(name, kind)| {
            let index = phrase(&normalized, name)?;
            Some((kind, index, index + name.len()))
        })
        .min_by_key(|(_, start, end)| (std::cmp::Reverse(end - start), *start))
}

fn explicit_id(query: &str) -> Option<u64> {
    let mut value = query.trim_start_matches(|c: char| c.is_whitespace() || c == ':');
    let lower = value.to_ascii_lowercase();
    for prefix in ["id ", "number "] {
        if lower.starts_with(prefix) {
            value = &value[prefix.len()..];
            break;
        }
    }
    value = value.trim_start_matches(|c: char| c.is_whitespace() || c == '#');
    let end = value.bytes().take_while(u8::is_ascii_digit).count();
    let tail = &value[end..];
    // A hyphenated ISO date, decimal number, and business reference with a
    // numeric prefix cannot become an authoritative record ID.
    let ends_sentence = tail
        .strip_prefix('.')
        .is_some_and(|next| next.is_empty() || next.starts_with(char::is_whitespace));
    if !tail.is_empty()
        && !ends_sentence
        && !tail
            .chars()
            .next()
            .is_some_and(|c| c.is_whitespace() || matches!(c, ',' | ')' | ']'))
    {
        return None;
    }
    let id: u64 = value[..end].parse().ok()?;
    // A bare year is not an ID. Use # or id to expressly select a
    // four-digit record whose number could be a year.
    let marked = query.contains('#') || lower.starts_with("id ") || lower.starts_with("number ");
    (id > 0 && (marked || !(1900..=2100).contains(&id))).then_some(id)
}

fn dates(text: &str) -> Vec<NaiveDate> {
    let words: Vec<_> = text
        .split(|c: char| !c.is_alphanumeric() && c != '-')
        .filter(|word| !word.is_empty())
        .collect();
    let mut dates = Vec::new();
    for word in &words {
        if word.len() != 10 {
            continue;
        }
        if let Ok(date) = NaiveDate::parse_from_str(word, "%Y-%m-%d") {
            dates.push(date);
        }
    }
    for parts in words.windows(3) {
        let candidate = parts.join(" ");
        for format in ["%B %e %Y", "%e %B %Y", "%b %e %Y", "%e %b %Y"] {
            if parts[2].len() == 4 {
                if let Ok(date) = NaiveDate::parse_from_str(&candidate, format) {
                    dates.push(date);
                    break;
                }
            }
        }
    }
    dates.sort_unstable();
    dates.dedup();
    dates
}

fn locator_label(after: &str) -> Option<String> {
    let value = after.trim_start_matches(|c: char| c.is_whitespace() || c == ':');
    let normalized = value.to_ascii_lowercase();
    let named = ["named ", "called ", "reference ", "ref ", "number "]
        .into_iter()
        .find(|prefix| normalized.starts_with(prefix));
    let value = named.map_or(value, |prefix| value[prefix.len()..].trim_start());
    let normalized = value.to_ascii_lowercase();
    if let Some(quote) = value.chars().next().filter(|c| matches!(c, '"' | '\'')) {
        let quoted = value[1..].split_once(quote)?.0.trim();
        return (!quoted.is_empty()).then(|| quoted.to_owned());
    }
    let end = value
        .char_indices()
        .find_map(|(index, c)| {
            if matches!(c, ',' | '?' | ';' | '!') {
                return Some(index);
            }
            (c.is_whitespace()
                && [
                    " what ", " which ", " for ", " on ", " dated ", " and ", " is ", " was ",
                ]
                .iter()
                .any(|marker| {
                    normalized
                        .get(index..)
                        .is_some_and(|tail| tail.starts_with(marker))
                }))
            .then_some(index)
        })
        .unwrap_or(value.len());
    let label = value[..end].trim().trim_matches(['.', ':']);
    let likely_reference = !label.contains(char::is_whitespace)
        && label.chars().any(|c| c.is_ascii_digit())
        && label.chars().any(|c| matches!(c, '/' | '-' | '_'));
    (named.is_some() || likely_reference)
        .then(|| label.to_owned())
        .filter(|label| !label.is_empty())
}

fn date_description(before: &str) -> Option<String> {
    let prefix = before.rsplit_once(',').map_or(before, |(_, suffix)| suffix);
    let mut words: Vec<_> = prefix
        .split(|c: char| !c.is_alphanumeric() && c != '-')
        .filter(|word| !word.is_empty())
        .filter(|word| {
            !matches!(
                word.to_ascii_lowercase().as_str(),
                "for"
                    | "about"
                    | "what"
                    | "which"
                    | "is"
                    | "was"
                    | "the"
                    | "a"
                    | "an"
                    | "please"
                    | "find"
                    | "show"
                    | "me"
                    | "tell"
                    | "of"
                    | "on"
                    | "posted"
                    | "draft"
                    | "debit"
                    | "credit"
                    | "amount"
                    | "total"
            )
        })
        .collect();
    if words.len() > 1
        && words
            .last()
            .is_some_and(|word| word.eq_ignore_ascii_case("expense"))
    {
        words.pop();
    }
    (!words.is_empty() && words.len() <= 6).then(|| words.join(" "))
}

fn parse_lookup(query: &str, ui_module: Option<&str>) -> Option<(RecordKind, Locator)> {
    let clause = primary_clause(query.trim()).trim();
    if clause.len() > 512 {
        return None;
    }
    let (kind, start, end) = identify(clause, ui_module)?;
    let after = &clause[end..];
    let after_lower = after.to_ascii_lowercase();
    let before = &clause[..start];
    if let Some((_, _, other_end)) = identify(before, ui_module) {
        let other = &before[other_end..];
        if explicit_id(other).is_some() || locator_label(other).is_some() {
            return None;
        }
    }
    if let Some((_, alternate)) = after_lower.split_once(" and ") {
        if identify(alternate, ui_module).is_some() || explicit_id(alternate).is_some() {
            return None;
        }
    }
    let normalized = clause.to_ascii_lowercase();
    if ["compare ", "between "]
        .iter()
        .any(|term| normalized.contains(term))
    {
        return None;
    }
    let posted =
        kind.move_kind.is_some() && phrase(&before.to_ascii_lowercase(), "posted").is_some();
    let dates = dates(clause);
    let date = match dates.as_slice() {
        [] => None,
        [date] => Some(*date),
        _ => return None,
    };
    if let Some(id) = explicit_id(after) {
        let date = date.filter(|_| phrase(&after_lower, "dated").is_some());
        return Some((kind, Locator::Id { id, date, posted }));
    }
    // Broad arithmetic or date-range questions use their own report readers.
    if ["how many ", "list all ", "all the "]
        .iter()
        .any(|term| normalized.contains(term))
    {
        return None;
    }
    let label = locator_label(after);
    let date_requested = ["dated", "on"]
        .iter()
        .any(|term| phrase(&after_lower, term).is_some());
    let label = label.or_else(|| {
        (date.is_some() && date_requested)
            .then(|| date_description(before))
            .flatten()
    });
    if label.is_none() && !(date.is_some() && date_requested) {
        return None;
    }
    Some((
        kind,
        Locator::Label {
            label,
            date: date.filter(|_| date_requested),
            posted,
        },
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LookupQuery<'a> {
    company_id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    record_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    move_kind: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    posted: Option<bool>,
}

#[derive(Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
enum Answer {
    Match { id: u64 },
    Empty,
    Ambiguous,
}

/// Find a candidate for a singular, bounded record reference. The authoritative
/// snapshot reader still verifies row and field access before using a result.
pub(crate) async fn lookup_record_candidates(
    state: &AppState,
    actor: &ActorCredentials,
    organization_id: u64,
    company_id: u64,
    query: &str,
    ui_module: Option<&str>,
) -> Result<RecordLookup> {
    let Some((kind, locator)) = parse_lookup(query, ui_module) else {
        return Ok(RecordLookup::NotRequested);
    };
    let Some(spec) = lookup_entity_spec(kind.entity_type) else {
        return Ok(RecordLookup::NotRequested);
    };
    ensure!(
        organization_id > 0 && company_id > 0,
        "ERP record lookup scope is missing"
    );
    let candidate = |entity_id| {
        RecordLookup::Match(EntityRef {
            entity_type: spec.entity_type.to_owned(),
            entity_id,
            priority: 1.0,
        })
    };
    let (record_id, label, date, posted) = match locator {
        Locator::Id { id, date: None, .. } if kind.move_kind.is_none() => return Ok(candidate(id)),
        Locator::Id { id, date, posted } => (Some(id), None, date, posted),
        Locator::Label {
            label,
            date,
            posted,
        } => (None, label, date, posted),
    };
    let api = state
        .config
        .api_server_url
        .as_deref()
        .map(str::trim)
        .filter(|base| !base.is_empty())
        .context("authoritative record lookup is unavailable")?;
    let response = state
        .http
        .get(format!(
            "{}/v1/authoritative-search/{}",
            api.trim_end_matches('/'),
            spec.api_resource
        ))
        .bearer_auth(actor.stdb_token.trim())
        .header("x-stdb-identity", actor.identity_hex.trim())
        .query(&LookupQuery {
            company_id,
            label: label.as_deref(),
            date: date.map(|date| date.to_string()),
            record_id,
            move_kind: kind.move_kind,
            posted: posted.then_some(true),
        })
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .context("authoritative record lookup failed")?;
    match response.status().as_u16() {
        401 | 403 | 404 | 422 => return Ok(RecordLookup::NotFound),
        _ => {}
    }
    let answer: Answer = response
        .error_for_status()
        .context("authoritative record lookup failed")?
        .json()
        .await
        .context("authoritative record lookup returned an invalid response")?;
    Ok(match answer {
        Answer::Match { id } if id > 0 => candidate(id),
        Answer::Match { .. } | Answer::Empty => RecordLookup::NotFound,
        Answer::Ambiguous => RecordLookup::Ambiguous,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requested_electricity_entry_uses_date_kind_and_description() {
        let answer = parse_lookup(
            "For the posted electricity expense journal entry dated April 9, 2024, what is the total and which account was debited? Cite the journal entry. Read only.",
            Some("accounting"),
        );
        assert_eq!(
            answer,
            Some((
                account_move("journal_entry"),
                Locator::Label {
                    label: Some("electricity".into()),
                    date: NaiveDate::from_ymd_opt(2024, 4, 9),
                    posted: true,
                },
            ))
        );
    }

    #[test]
    fn exact_ids_and_named_references_support_navigation_without_reading_amounts_as_ids() {
        assert_eq!(
            parse_lookup("Open fleet vehicle #81", None),
            Some((
                kind("fleet_vehicle"),
                Locator::Id {
                    id: 81,
                    date: None,
                    posted: false
                }
            ))
        );
        assert_eq!(
            parse_lookup("What is the total on order 51?", Some("sales")),
            Some((
                kind("sale_order"),
                Locator::Id {
                    id: 51,
                    date: None,
                    posted: false
                }
            ))
        );
        assert_eq!(
            parse_lookup("Show purchase order PO-2024-93", None),
            Some((
                kind("purchase_order"),
                Locator::Label {
                    label: Some("PO-2024-93".into()),
                    date: None,
                    posted: false
                }
            ))
        );
        assert_eq!(
            parse_lookup("Open contact named Dr. Élodie Martin?", None),
            Some((
                kind("contact"),
                Locator::Label {
                    label: Some("Dr. Élodie Martin".into()),
                    date: None,
                    posted: false
                }
            ))
        );
        assert_eq!(parse_lookup("Invoice 120.90", None), None);
        assert_eq!(parse_lookup("Invoice 2024", None), None);
        assert_eq!(
            parse_lookup("Show the posted journal entry #90 dated 2024-04-09", None),
            Some((
                account_move("journal_entry"),
                Locator::Id {
                    id: 90,
                    date: NaiveDate::from_ymd_opt(2024, 4, 9),
                    posted: true
                }
            ))
        );
        assert_eq!(
            parse_lookup("Invoice on 2024-04-09", None),
            Some((
                account_move("invoice"),
                Locator::Label {
                    label: None,
                    date: NaiveDate::from_ymd_opt(2024, 4, 9),
                    posted: false
                }
            ))
        );
    }

    #[test]
    fn a_broad_question_or_ambiguous_date_range_is_not_a_record_lookup() {
        for query in [
            "What can you help me do on this Accounting page?",
            "How many sales orders were posted on April 9, 2024?",
            "Compare invoice 51 and invoice 52.",
            "Show journal entry #51 and purchase order #52.",
            "Show invoice 51 and 52.",
            "What is the total for the journal entry dated 2024-04-09 and 2024-04-10?",
        ] {
            assert_eq!(parse_lookup(query, Some("accounting")), None, "{query}");
        }
    }
}
