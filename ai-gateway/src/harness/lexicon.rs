//! Locale lexicons for the read planner.
//!
//! The word lists live in `erp-skills/rag_generation/lexicon/<locale>.json`
//! and are embedded at build time. Matching uses Unicode NFKC and case folding
//! (not ASCII lowercasing) so accented and non-English questions route the same
//! way as English ones. Lists are data, never code: add a phrase to a JSON file
//! to teach the planner a word.

use std::{
    collections::{BTreeMap, HashMap},
    sync::OnceLock,
};

use serde::Deserialize;
use unicode_normalization::UnicodeNormalization;

use super::{entity_registry::lookup_entity_spec, read_plan::RecordKind};

/// Repository-owned skills a summary phrase may hand off to.
pub(crate) const HANDOFF_SKILLS: &[&str] = &[
    "report_analysis",
    "finance_report_review",
    "finance_variance_review",
    "period_close_review",
    "bank_reconciliation_review",
    "insights_scan",
    "daily_briefing",
];

pub(crate) fn nfkc(text: &str) -> String {
    text.nfkc().collect()
}

pub(crate) fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Byte index of the first whole-word occurrence of `term` in `haystack`.
pub(crate) fn find_phrase(haystack: &str, term: &str) -> Option<usize> {
    if term.is_empty() {
        return None;
    }
    haystack
        .match_indices(term)
        .find(|&(index, _)| {
            !haystack[..index].chars().next_back().is_some_and(is_word)
                && !haystack[index + term.len()..]
                    .chars()
                    .next()
                    .is_some_and(is_word)
        })
        .map(|(index, _)| index)
}

/// NFKC-normalized text plus a case-folded view of it. Whitespace runs collapse
/// to one space in the folded view. `original` maps folded byte offsets back to
/// byte offsets in `text`, so a label found in the folded view can be sliced
/// from the user's original capitalization.
pub(crate) struct Folded {
    pub text: String,
    pub folded: String,
    map: Vec<usize>,
}

impl Folded {
    pub fn new(input: &str) -> Self {
        let text = nfkc(input);
        let mut folded = String::with_capacity(text.len());
        let mut map = Vec::with_capacity(text.len() + 1);
        let mut previous_space = false;
        for (index, c) in text.char_indices() {
            if c.is_whitespace() {
                if !previous_space {
                    folded.push(' ');
                    map.push(index);
                }
                previous_space = true;
                continue;
            }
            previous_space = false;
            let c = if c == '\u{2019}' || c == '\u{2018}' {
                '\''
            } else {
                c
            };
            for lower in c.to_lowercase() {
                let start = folded.len();
                folded.push(lower);
                for _ in start..folded.len() {
                    map.push(index);
                }
            }
        }
        map.push(text.len());
        Self { text, folded, map }
    }

    /// Byte offset in `text` for a byte offset in `folded`.
    pub fn original(&self, folded_index: usize) -> usize {
        self.map[folded_index.min(self.map.len() - 1)]
    }

    /// Original-text byte range of the first whole-word `term`.
    pub fn find(&self, term: &str) -> Option<(usize, usize)> {
        let start = find_phrase(&self.folded, term)?;
        Some((self.original(start), self.original(start + term.len())))
    }

    pub fn has(&self, term: &str) -> bool {
        find_phrase(&self.folded, term).is_some()
    }

    pub fn has_any(&self, terms: &[String]) -> bool {
        terms.iter().any(|term| self.has(term))
    }

    /// Original-text offset just after `term` when the text starts with it as
    /// a whole word.
    pub fn strip_start(&self, term: &str) -> Option<usize> {
        if term.is_empty() || !self.folded.starts_with(term) {
            return None;
        }
        if self.folded[term.len()..]
            .chars()
            .next()
            .is_some_and(is_word)
        {
            return None;
        }
        Some(self.original(term.len()))
    }

    pub fn strip_start_any(&self, terms: &[String]) -> Option<usize> {
        terms.iter().find_map(|term| self.strip_start(term))
    }
}

/// Fold a lexicon term exactly like query text.
pub(crate) fn fold(term: &str) -> String {
    Folded::new(term.trim()).folded
}

// ----- JSON schema ---------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AliasEntry {
    pub term: String,
    pub entity_type: String,
    #[serde(default)]
    pub move_kind: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RelativePeriod {
    pub term: String,
    pub unit: String,
    pub offset: i32,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SkillTrigger {
    pub phrase: String,
    pub skill: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Words {
    pub id: Vec<String>,
    pub named: Vec<String>,
    pub label_stop: Vec<String>,
    pub date_filler: Vec<String>,
    pub date_trailing_noise: Vec<String>,
    pub posted: Vec<String>,
    pub dated: Vec<String>,
    pub on: Vec<String>,
    pub and: Vec<String>,
    pub compare: Vec<String>,
    pub aggregate: Vec<String>,
    pub single_record_exclusions: Vec<String>,
    pub read_verbs: Vec<String>,
    pub date_glue: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PeriodWords {
    pub range_words: Vec<String>,
    pub range_connectors: Vec<String>,
    pub year_prepositions: Vec<String>,
    pub as_of: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SalesWords {
    pub shop: Vec<String>,
    pub customer: Vec<String>,
    pub historical: Vec<String>,
    pub totals: Vec<String>,
    pub show_verbs: Vec<String>,
    pub mutation_verbs: Vec<String>,
    pub modifiers: Vec<String>,
    pub label_prepositions: Vec<String>,
    pub all_scope: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FarmWords {
    pub batch: Vec<String>,
    pub metrics: Vec<String>,
    pub all: Vec<String>,
    pub compare: Vec<String>,
    pub conjunctions: Vec<String>,
    pub articles: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SupportWords {
    pub read_prefixes: Vec<String>,
    pub articles: Vec<String>,
    pub calendar: Vec<String>,
    pub approval: Vec<String>,
    pub document: Vec<String>,
    pub detail_words: Vec<String>,
    pub id_words: Vec<String>,
    pub suffix_words: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LexiconFile {
    pub locale: String,
    #[serde(default)]
    pub review: Option<String>,
    pub record_aliases: Vec<AliasEntry>,
    pub module_aliases: BTreeMap<String, Vec<AliasEntry>>,
    pub words: Words,
    pub months: Vec<Vec<String>>,
    pub relative_periods: Vec<RelativePeriod>,
    pub period: PeriodWords,
    pub reference_words: Vec<String>,
    pub guide_triggers: Vec<String>,
    pub sales: SalesWords,
    pub farm: FarmWords,
    pub support: SupportWords,
    pub skills: Vec<SkillTrigger>,
}

const SOURCES: [(&str, &str); 5] = [
    (
        "en",
        include_str!("../../../erp-skills/rag_generation/lexicon/en.json"),
    ),
    (
        "fr",
        include_str!("../../../erp-skills/rag_generation/lexicon/fr.json"),
    ),
    (
        "rw",
        include_str!("../../../erp-skills/rag_generation/lexicon/rw.json"),
    ),
    (
        "sw",
        include_str!("../../../erp-skills/rag_generation/lexicon/sw.json"),
    ),
    (
        "pt-BR",
        include_str!("../../../erp-skills/rag_generation/lexicon/pt-BR.json"),
    ),
];

pub(crate) fn parse_sources() -> Result<Vec<(&'static str, LexiconFile)>, String> {
    let mut files = Vec::new();
    for (name, source) in SOURCES {
        let file: LexiconFile =
            serde_json::from_str(source).map_err(|error| format!("lexicon {name}: {error}"))?;
        validate(name, &file)?;
        files.push((name, file));
    }
    Ok(files)
}

fn record_kind(entry: &AliasEntry) -> Result<RecordKind, String> {
    let spec = lookup_entity_spec(&entry.entity_type)
        .ok_or_else(|| format!("unknown entity type '{}'", entry.entity_type))?;
    let move_kind = match entry.move_kind.as_deref() {
        None => None,
        Some("journal_entry") => Some("journal_entry"),
        Some("invoice") => Some("invoice"),
        Some("vendor_bill") => Some("vendor_bill"),
        Some(other) => return Err(format!("unknown move kind '{other}'")),
    };
    Ok(RecordKind {
        entity_type: spec.entity_type,
        move_kind,
    })
}

fn validate(name: &str, file: &LexiconFile) -> Result<(), String> {
    let fail = |message: String| Err(format!("lexicon {name}: {message}"));
    if file.locale != name {
        return fail(format!("locale '{}' does not match its file", file.locale));
    }
    if file.record_aliases.is_empty() {
        return fail("record_aliases is empty".into());
    }
    if file.months.len() != 12 || file.months.iter().any(Vec::is_empty) {
        return fail("months needs 12 non-empty lists".into());
    }
    if (name == "rw" || name == "sw") && file.review.is_none() {
        return fail("needs a review note for native-speaker review".into());
    }
    for entry in file
        .record_aliases
        .iter()
        .chain(file.module_aliases.values().flatten())
    {
        if fold(&entry.term).is_empty() {
            return fail("empty alias term".into());
        }
        record_kind(entry).map_err(|error| format!("lexicon {name}: {error}"))?;
    }
    for period in &file.relative_periods {
        if !matches!(period.unit.as_str(), "month" | "year") || fold(&period.term).is_empty() {
            return fail(format!("invalid relative period '{}'", period.term));
        }
    }
    for trigger in &file.skills {
        if !HANDOFF_SKILLS.contains(&trigger.skill.as_str()) || fold(&trigger.phrase).is_empty() {
            return fail(format!("invalid skill trigger '{}'", trigger.phrase));
        }
    }
    let lists: [&Vec<String>; 8] = [
        &file.words.id,
        &file.words.read_verbs,
        &file.sales.shop,
        &file.sales.customer,
        &file.sales.totals,
        &file.farm.batch,
        &file.support.calendar,
        &file.support.document,
    ];
    if lists.iter().any(|list| list.is_empty()) {
        return fail("a required word list is empty".into());
    }
    let all_words = file
        .words
        .id
        .iter()
        .chain(&file.words.named)
        .chain(&file.words.label_stop)
        .chain(&file.reference_words)
        .chain(&file.guide_triggers);
    for word in all_words {
        if word.chars().any(char::is_control) || fold(word).is_empty() {
            return fail(format!("invalid word '{word}'"));
        }
    }
    Ok(())
}

// ----- Merged, folded view ---------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PeriodUnit {
    Month,
    Year,
}

#[derive(Debug, Default)]
pub(crate) struct Merged {
    pub aliases: Vec<(String, RecordKind)>,
    pub module_aliases: HashMap<String, Vec<(String, RecordKind)>>,
    pub months: Vec<(String, u32)>,
    pub relative_periods: Vec<(String, PeriodUnit, i32)>,
    pub skills: Vec<(String, &'static str)>,
    pub id: Vec<String>,
    pub named: Vec<String>,
    pub label_stop: Vec<String>,
    pub date_filler: Vec<String>,
    pub date_trailing_noise: Vec<String>,
    pub posted: Vec<String>,
    pub dated: Vec<String>,
    pub on: Vec<String>,
    pub and: Vec<String>,
    pub compare: Vec<String>,
    pub aggregate: Vec<String>,
    pub single_record_exclusions: Vec<String>,
    pub read_verbs: Vec<String>,
    pub date_glue: Vec<String>,
    pub range_words: Vec<String>,
    pub range_connectors: Vec<String>,
    pub year_prepositions: Vec<String>,
    pub as_of: Vec<String>,
    pub reference_words: Vec<String>,
    pub guide_triggers: Vec<String>,
    pub shop: Vec<String>,
    pub customer: Vec<String>,
    pub historical: Vec<String>,
    pub totals: Vec<String>,
    pub show_verbs: Vec<String>,
    pub mutation_verbs: Vec<String>,
    pub modifiers: Vec<String>,
    pub label_prepositions: Vec<String>,
    pub all_scope: Vec<String>,
    pub farm_batch: Vec<String>,
    pub farm_metrics: Vec<String>,
    pub farm_all: Vec<String>,
    pub farm_compare: Vec<String>,
    pub farm_conjunctions: Vec<String>,
    pub farm_articles: Vec<String>,
    pub support_read_prefixes: Vec<String>,
    pub support_articles: Vec<String>,
    pub support_calendar: Vec<String>,
    pub support_approval: Vec<String>,
    pub support_document: Vec<String>,
    pub support_detail_words: Vec<String>,
    pub support_id_words: Vec<String>,
    pub support_suffix_words: Vec<String>,
}

/// Folded, de-duplicated, longest-first union of one list across files.
fn list<F>(files: &[&LexiconFile], pick: F) -> Vec<String>
where
    F: for<'a> Fn(&'a LexiconFile) -> &'a Vec<String>,
{
    let mut out: Vec<String> = Vec::new();
    for file in files {
        for term in pick(file) {
            let term = fold(term);
            if !term.is_empty() && !out.contains(&term) {
                out.push(term);
            }
        }
    }
    out.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
    out
}

fn aliases(entries: &[&AliasEntry]) -> Vec<(String, RecordKind)> {
    let mut out: Vec<(String, RecordKind)> = Vec::new();
    for entry in entries {
        // Validated when the lexicons were parsed.
        let Ok(kind) = record_kind(entry) else {
            continue;
        };
        let term = fold(&entry.term);
        if !out.iter().any(|(existing, _)| *existing == term) {
            out.push((term, kind));
        }
    }
    out
}

fn skill_key(name: &str) -> Option<&'static str> {
    HANDOFF_SKILLS.iter().copied().find(|skill| *skill == name)
}

fn merge(files: &[&LexiconFile]) -> Merged {
    let mut merged = Merged::default();
    let all_aliases: Vec<&AliasEntry> = files
        .iter()
        .flat_map(|file| file.record_aliases.iter())
        .collect();
    merged.aliases = aliases(&all_aliases);
    let mut modules: Vec<&String> = files
        .iter()
        .flat_map(|file| file.module_aliases.keys())
        .collect();
    modules.sort();
    modules.dedup();
    for module in modules {
        let entries: Vec<&AliasEntry> = files
            .iter()
            .filter_map(|file| file.module_aliases.get(module))
            .flatten()
            .collect();
        merged
            .module_aliases
            .insert(module.clone(), aliases(&entries));
    }
    for file in files {
        for (index, names) in file.months.iter().enumerate() {
            for name in names {
                let name = fold(name);
                if !merged.months.iter().any(|(existing, _)| *existing == name) {
                    merged.months.push((name, index as u32 + 1));
                }
            }
        }
        for period in &file.relative_periods {
            let unit = if period.unit == "year" {
                PeriodUnit::Year
            } else {
                PeriodUnit::Month
            };
            merged
                .relative_periods
                .push((fold(&period.term), unit, period.offset));
        }
        for trigger in &file.skills {
            if let Some(skill) = skill_key(&trigger.skill) {
                merged.skills.push((fold(&trigger.phrase), skill));
            }
        }
    }
    merged.months.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
    merged
        .relative_periods
        .sort_by(|a, b| b.0.len().cmp(&a.0.len()));
    merged.skills.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
    merged.id = list(files, |f| &f.words.id);
    merged.named = list(files, |f| &f.words.named);
    merged.label_stop = list(files, |f| &f.words.label_stop);
    merged.date_filler = list(files, |f| &f.words.date_filler);
    merged.date_trailing_noise = list(files, |f| &f.words.date_trailing_noise);
    merged.posted = list(files, |f| &f.words.posted);
    merged.dated = list(files, |f| &f.words.dated);
    merged.on = list(files, |f| &f.words.on);
    merged.and = list(files, |f| &f.words.and);
    merged.compare = list(files, |f| &f.words.compare);
    merged.aggregate = list(files, |f| &f.words.aggregate);
    merged.single_record_exclusions = list(files, |f| &f.words.single_record_exclusions);
    merged.read_verbs = list(files, |f| &f.words.read_verbs);
    merged.date_glue = list(files, |f| &f.words.date_glue);
    merged.range_words = list(files, |f| &f.period.range_words);
    merged.range_connectors = list(files, |f| &f.period.range_connectors);
    merged.year_prepositions = list(files, |f| &f.period.year_prepositions);
    merged.as_of = list(files, |f| &f.period.as_of);
    merged.reference_words = list(files, |f| &f.reference_words);
    merged.guide_triggers = list(files, |f| &f.guide_triggers);
    merged.shop = list(files, |f| &f.sales.shop);
    merged.customer = list(files, |f| &f.sales.customer);
    merged.historical = list(files, |f| &f.sales.historical);
    merged.totals = list(files, |f| &f.sales.totals);
    merged.show_verbs = list(files, |f| &f.sales.show_verbs);
    merged.mutation_verbs = list(files, |f| &f.sales.mutation_verbs);
    merged.modifiers = list(files, |f| &f.sales.modifiers);
    merged.label_prepositions = list(files, |f| &f.sales.label_prepositions);
    merged.all_scope = list(files, |f| &f.sales.all_scope);
    merged.farm_batch = list(files, |f| &f.farm.batch);
    merged.farm_metrics = list(files, |f| &f.farm.metrics);
    merged.farm_all = list(files, |f| &f.farm.all);
    merged.farm_compare = list(files, |f| &f.farm.compare);
    merged.farm_conjunctions = list(files, |f| &f.farm.conjunctions);
    merged.farm_articles = list(files, |f| &f.farm.articles);
    merged.support_read_prefixes = list(files, |f| &f.support.read_prefixes);
    merged.support_articles = list(files, |f| &f.support.articles);
    merged.support_calendar = list(files, |f| &f.support.calendar);
    merged.support_approval = list(files, |f| &f.support.approval);
    merged.support_document = list(files, |f| &f.support.document);
    merged.support_detail_words = list(files, |f| &f.support.detail_words);
    merged.support_id_words = list(files, |f| &f.support.id_words);
    merged.support_suffix_words = list(files, |f| &f.support.suffix_words);
    merged
}

fn build() -> Result<HashMap<&'static str, Merged>, String> {
    let parsed = parse_sources()?;
    let file = |name: &str| -> Result<&LexiconFile, String> {
        parsed
            .iter()
            .find(|(candidate, _)| *candidate == name)
            .map(|(_, file)| file)
            .ok_or_else(|| format!("lexicon {name} is missing"))
    };
    let en = file("en")?;
    let fr = file("fr")?;
    let rw = file("rw")?;
    let sw = file("sw")?;
    let pt = file("pt-BR")?;
    let mut sets = HashMap::new();
    sets.insert("en", merge(&[en]));
    sets.insert("fr", merge(&[fr, en]));
    sets.insert("rw", merge(&[rw, en, fr]));
    sets.insert("sw", merge(&[sw, en]));
    sets.insert("pt-BR", merge(&[pt, en]));
    Ok(sets)
}

static LEXICONS: OnceLock<HashMap<&'static str, Merged>> = OnceLock::new();

/// Parse and validate every embedded lexicon. Call at startup so a bad file
/// stops the gateway instead of failing a user's question.
pub(crate) fn init() -> Result<(), String> {
    let built = build()?;
    let _ = LEXICONS.set(built);
    Ok(())
}

fn locale_key(locale: Option<&str>) -> &'static str {
    let tag = locale.unwrap_or("").trim().to_ascii_lowercase();
    if tag.starts_with("rw") {
        "rw"
    } else if tag.starts_with("fr") {
        "fr"
    } else if tag.starts_with("sw") {
        "sw"
    } else if tag.starts_with("pt") {
        "pt-BR"
    } else {
        "en"
    }
}

/// The folded word lists for a UI locale. English is always included, and
/// Kinyarwanda adds French and English loanwords.
pub(crate) fn for_locale(locale: Option<&str>) -> &'static Merged {
    let sets = LEXICONS.get_or_init(|| build().expect("embedded lexicons are valid"));
    sets.get(locale_key(locale))
        .or_else(|| sets.get("en"))
        .expect("English lexicon is present")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folding_keeps_original_offsets_for_labels() {
        let text = Folded::new("Open contact named Dr. \u{c9}lodie  Martin");
        assert_eq!(text.folded, "open contact named dr. \u{e9}lodie martin");
        let (start, end) = text.find("named").expect("named");
        assert_eq!(&text.text[start..end], "named");
        let (_, end) = text.find("dr.").map_or((0, 0), |range| range);
        let _ = end;
        let (start, end) = text.find("\u{e9}lodie").expect("name");
        assert_eq!(&text.text[start..end], "\u{c9}lodie");
    }

    #[test]
    fn nfkc_folds_fullwidth_and_composed_forms() {
        assert_eq!(fold("\u{ff29}nvoice"), "invoice");
        assert_eq!(fold("e\u{301}t\u{e9}"), "\u{e9}t\u{e9}");
    }

    #[test]
    fn embedded_lexicons_parse_and_validate() {
        let files = parse_sources().expect("lexicons");
        assert_eq!(files.len(), 5);
        let en = &files[0].1;
        assert!(en.record_aliases.len() >= 30);
        // Every entity type the English lexicon names is named in every locale.
        let types = |file: &LexiconFile| -> Vec<(String, Option<String>)> {
            let mut types: Vec<_> = file
                .record_aliases
                .iter()
                .map(|entry| (entry.entity_type.clone(), entry.move_kind.clone()))
                .collect();
            types.sort();
            types.dedup();
            types
        };
        for (name, file) in &files {
            let covered = types(file);
            for expected in types(en) {
                assert!(covered.contains(&expected), "{name} lacks {expected:?}");
            }
        }
    }

    #[test]
    fn unverified_locales_carry_a_review_note() {
        let files = parse_sources().expect("lexicons");
        for (name, file) in &files {
            if *name == "rw" || *name == "sw" {
                assert_eq!(
                    file.review.as_deref(),
                    Some("needs native-speaker review"),
                    "{name}"
                );
            }
        }
    }

    #[test]
    fn locales_resolve_with_english_and_loanword_fallbacks() {
        assert_eq!(locale_key(Some("rw-x-fr")), "rw");
        assert_eq!(locale_key(Some("pt-BR")), "pt-BR");
        assert_eq!(locale_key(None), "en");
        assert!(for_locale(Some("fr"))
            .aliases
            .iter()
            .any(|(t, _)| t == "invoice"));
        assert!(for_locale(Some("rw"))
            .aliases
            .iter()
            .any(|(t, _)| t == "facture"));
    }
}
