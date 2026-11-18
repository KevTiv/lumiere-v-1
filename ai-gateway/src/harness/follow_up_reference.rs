//! Follow-up anchors: when a question refers back to the previous answer's
//! records ("is it paid?") instead of naming a record of its own.
//!
//! Anchors are identities only. They are re-authorized and re-read like any
//! other candidate, and never outrank a record the user names or has open.

use crate::harness::{entity_registry::lookup_entity_spec, EntityRef};

/// Most anchors a single envelope may carry; mirrors the api-server cap.
pub const MAX_ANCHORS: usize = 8;

/// Reference phrases as folded token sequences (see `fold_tokens`).
///
/// AIH-32 moves this table into the lexicon files. Keep entries conservative:
/// a false positive only adds a lower-priority, freshly authorized candidate.
pub const REFERENCE_PHRASES: &[&[&str]] = &[
    // English
    &["it"],
    &["its"],
    &["them"],
    &["their"],
    &["the", "same"],
    &["that", "one"],
    &["this", "one"],
    &["that", "invoice"],
    &["this", "invoice"],
    &["that", "bill"],
    &["this", "bill"],
    &["that", "order"],
    &["this", "order"],
    &["that", "record"],
    &["this", "record"],
    &["that", "customer"],
    &["this", "customer"],
    &["that", "supplier"],
    &["this", "supplier"],
    &["that", "payment"],
    &["this", "payment"],
    &["that", "product"],
    &["this", "product"],
    // French
    &["il"],
    &["elle"],
    &["ils"],
    &["elles"],
    &["celui", "ci"],
    &["celle", "ci"],
    &["ce"],
    &["ca"],
    &["cela"],
    &["cette", "facture"],
    &["cette", "commande"],
    &["ce", "client"],
    &["ce", "fournisseur"],
    &["ce", "produit"],
    &["le", "meme"],
    &["la", "meme"],
    // Kinyarwanda (conservative: demonstrative plus noun)
    &["iyi", "fagitire"],
    &["iyo", "fagitire"],
    &["uyu", "mukiriya"],
    &["uwo", "mukiriya"],
    // Swahili
    &["hiyo", "ankara"],
    &["ankara", "hiyo"],
    &["ankara", "hii"],
    &["ankara", "ile"],
    &["yake"],
];

fn fold_char(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' => 'a',
        'ç' => 'c',
        'è' | 'é' | 'ê' | 'ë' => 'e',
        'ì' | 'í' | 'î' | 'ï' => 'i',
        'ñ' => 'n',
        'ò' | 'ó' | 'ô' | 'ö' | 'õ' => 'o',
        'ù' | 'ú' | 'û' | 'ü' => 'u',
        'ÿ' | 'ý' => 'y',
        other => other,
    }
}

/// Case-fold, strip common Latin diacritics and split on anything that is not
/// a letter or digit, so "Celui-ci", "ÇA" and "it's" tokenize predictably.
fn fold_tokens(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for c in text.chars().flat_map(char::to_lowercase) {
        let c = fold_char(c);
        if c.is_alphanumeric() {
            current.push(c);
        } else if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

/// True when the question contains a back-reference word or phrase.
pub fn has_reference_word(question: &str) -> bool {
    let tokens = fold_tokens(question);
    REFERENCE_PHRASES.iter().any(|phrase| {
        tokens.windows(phrase.len()).any(|window| {
            window
                .iter()
                .zip(phrase.iter())
                .all(|(token, word)| token == word)
        })
    })
}

/// Parse envelope `anchorRefs` defensively. Entries that are malformed, of an
/// unknown type, or duplicated are dropped; the list is capped.
pub fn parse_anchor_refs(values: &[serde_json::Value]) -> Vec<EntityRef> {
    let mut anchors: Vec<EntityRef> = Vec::new();
    for value in values {
        let Some(entity_type) = value.get("entityType").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(spec) = lookup_entity_spec(entity_type) else {
            continue;
        };
        let id = match value.get("entityId") {
            Some(serde_json::Value::String(text)) => text.parse::<u64>().ok(),
            Some(serde_json::Value::Number(number)) => number.as_u64(),
            _ => None,
        };
        let Some(entity_id) = id.filter(|id| *id > 0) else {
            continue;
        };
        if anchors
            .iter()
            .any(|a| a.entity_type == spec.entity_type && a.entity_id == entity_id)
        {
            continue;
        }
        // Earlier anchors outrank later ones; all rank below any named record.
        anchors.push(EntityRef {
            entity_type: spec.entity_type.to_string(),
            entity_id,
            priority: 0.99 - anchors.len() as f32 * 0.001,
        });
        if anchors.len() == MAX_ANCHORS {
            break;
        }
    }
    anchors
}

/// What the current question established about its own record.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NamedRecord {
    /// No record was named (or looked up).
    None,
    /// A record reference was named but no accessible record matched.
    NotFound,
    /// A record was named and resolved; it replaces any anchor.
    Resolved,
}

/// Decide whether the previous answer's anchors apply to this question.
///
/// Anchors apply only when the question names no record of its own and no
/// record is open in the UI, or when it contains a reference word. A resolved
/// named record always replaces them, and a named record that was not found
/// only falls back to anchors when the question also refers back.
pub fn anchors_apply(
    cleared: bool,
    anchors: &[EntityRef],
    ui_record: bool,
    named: NamedRecord,
    question: &str,
) -> bool {
    if cleared || anchors.is_empty() || named == NamedRecord::Resolved {
        return false;
    }
    let refers_back = has_reference_word(question);
    match named {
        NamedRecord::NotFound => refers_back,
        _ => !ui_record || refers_back,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn anchor(entity_type: &str, id: u64) -> EntityRef {
        EntityRef {
            entity_type: entity_type.into(),
            entity_id: id,
            priority: 0.99,
        }
    }

    #[test]
    fn reference_words_match_in_english_french_and_local_forms() {
        for question in [
            "is it paid?",
            "What is its due date",
            "show me that invoice again",
            "Is THIS INVOICE overdue?",
            "est-il payé ?",
            "Elle est payée ?",
            "Et celui-ci ?",
            "Quel est le total de CETTE FACTURE ?",
            "Ça a été payé ?",
            "c'est quoi ce client",
            "iyi fagitire yishyuwe?",
            "ankara hiyo imelipwa?",
        ] {
            assert!(has_reference_word(question), "{question}");
        }
        for question in [
            "show invoice 123",
            "total sales this month",
            "item list for the warehouse",
            "montre la facture 123",
            "what are our open orders",
        ] {
            assert!(!has_reference_word(question), "{question}");
        }
    }

    #[test]
    fn anchor_entries_are_validated_deduplicated_and_capped() {
        let mut values = vec![
            json!({"entityType":"account_move","entityId":"123"}),
            json!({"entityType":"account-move","entityId":123}),
            json!({"entityType":"unknown_table","entityId":"5"}),
            json!({"entityType":"contact","entityId":"0"}),
            json!({"entityType":"contact","entityId":"x"}),
            json!({"entityType":"contact"}),
            json!("not an object"),
            json!({"entityType":"contact","entityId":"7"}),
        ];
        let anchors = parse_anchor_refs(&values);
        assert_eq!(anchors.len(), 2);
        assert_eq!(anchors[0].entity_type, "account_move");
        assert_eq!(anchors[0].entity_id, 123);
        assert_eq!(anchors[1].entity_id, 7);
        assert!(anchors[0].priority > anchors[1].priority);
        values = (1..=20)
            .map(|id| json!({"entityType":"product","entityId":id.to_string()}))
            .collect();
        assert_eq!(parse_anchor_refs(&values).len(), MAX_ANCHORS);
    }

    #[test]
    fn anchors_apply_rules() {
        let anchors = [anchor("account_move", 123)];
        let none = NamedRecord::None;
        // No own record and nothing open: anchors apply.
        assert!(anchors_apply(false, &anchors, false, none, "is it paid?"));
        assert!(anchors_apply(false, &anchors, false, none, "paid?"));
        // A record is open in the UI: only a reference word brings anchors.
        assert!(!anchors_apply(false, &anchors, true, none, "total sales?"));
        assert!(anchors_apply(false, &anchors, true, none, "is it paid?"));
        // A newly named record replaces anchors.
        assert!(!anchors_apply(
            false,
            &anchors,
            false,
            NamedRecord::Resolved,
            "is it paid?"
        ));
        // A named-but-missing record falls back only on a reference word.
        assert!(!anchors_apply(
            false,
            &anchors,
            false,
            NamedRecord::NotFound,
            "show invoice 999"
        ));
        assert!(anchors_apply(
            false,
            &anchors,
            false,
            NamedRecord::NotFound,
            "is it paid?"
        ));
        // Explicit clear, or no anchors, never applies.
        assert!(!anchors_apply(true, &anchors, false, none, "is it paid?"));
        assert!(!anchors_apply(false, &[], false, none, "is it paid?"));
    }
}
