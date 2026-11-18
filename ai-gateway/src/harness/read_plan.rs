//! One multilingual read planner.
//!
//! `plan` turns a question into a `ReadPlan` using only the locale lexicons
//! (`erp-skills/rag_generation/lexicon`). It never calls a model and never
//! reads data: executing a plan, and authorizing every row it returns, belongs
//! to the gateway handlers. Anything the lexicon cannot place is `Semantic`,
//! unless a `PlanFallback` (the hook reserved for a future router model)
//! says otherwise. The default fallback always answers `Semantic`.

#![allow(dead_code)]

use chrono::{Datelike, NaiveDate};
use serde_json::{json, Value};

use super::{
    lexicon::{self, Folded, Merged, PeriodUnit},
    record_lookup,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RecordKind {
    pub entity_type: &'static str,
    pub move_kind: Option<&'static str>,
}

#[derive(Debug, PartialEq, Eq, Clone)]
pub(crate) enum Locator {
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct DateRange {
    pub from: NaiveDate,
    pub through: NaiveDate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SalesModule {
    Sales,
    ShopSales,
}

impl SalesModule {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sales => "sales",
            Self::ShopSales => "shop_sales",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum FarmSelector {
    Id(String),
    Reference(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SupportTarget {
    CalendarEvent,
    Approval,
    Document,
}

impl SupportTarget {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CalendarEvent => "calendar_event",
            Self::Approval => "workflow_human_task",
            Self::Document => "document",
        }
    }
}

/// What the question still needs before it can run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Missing {
    Period,
    Source,
    LabelQuotes,
    FarmDate,
    FarmCompare,
    FarmSelectors,
    /// A record reference matched more than one record.
    Record,
}

impl Missing {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Period => "period",
            Self::Source => "source",
            Self::LabelQuotes => "label_quotes",
            Self::FarmDate => "farm_date",
            Self::FarmCompare => "farm_compare",
            Self::FarmSelectors => "farm_selectors",
            Self::Record => "record",
        }
    }
}

/// A button the web renders. Selecting it sends `resend` as the next question.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Choice {
    pub label: String,
    pub resend: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ReadPlan {
    Record {
        kind: RecordKind,
        locator: Locator,
    },
    FollowUp,
    PeriodSummary {
        module: SalesModule,
        range: DateRange,
        label: Option<String>,
    },
    FarmPortfolio {
        as_of: Option<NaiveDate>,
    },
    /// Two to five batches, or one batch's metrics.
    FarmComparison {
        selectors: Vec<FarmSelector>,
        as_of: Option<NaiveDate>,
    },
    SupportRecord {
        target: SupportTarget,
        id: u64,
    },
    Guide,
    Semantic,
    /// A report/review phrase naming a repository-owned skill. The variant and
    /// its lexicon exist here; the skill runner wires it separately.
    Handoff {
        skill: &'static str,
        period: Option<DateRange>,
        module: Option<String>,
        focus: Option<String>,
    },
    Clarify {
        missing: Missing,
        choices: Vec<Choice>,
    },
}

fn day(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

impl ReadPlan {
    /// Stable JSON form used by the parity fixtures.
    pub fn to_json(&self) -> Value {
        match self {
            Self::Record { kind, locator } => {
                let mut value = json!({"plan": "record", "entity_type": kind.entity_type});
                if let Some(move_kind) = kind.move_kind {
                    value["move_kind"] = json!(move_kind);
                }
                let (date, posted) = match locator {
                    Locator::Id { id, date, posted } => {
                        value["id"] = json!(id);
                        (date, posted)
                    }
                    Locator::Label {
                        label,
                        date,
                        posted,
                    } => {
                        if let Some(label) = label {
                            value["label"] = json!(label);
                        }
                        (date, posted)
                    }
                };
                if let Some(date) = date {
                    value["date"] = json!(day(*date));
                }
                if *posted {
                    value["posted"] = json!(true);
                }
                value
            }
            Self::FollowUp => json!({"plan": "follow_up"}),
            Self::PeriodSummary {
                module,
                range,
                label,
            } => {
                let mut value = json!({
                    "plan": "period_summary",
                    "module": module.as_str(),
                    "from": day(range.from),
                    "through": day(range.through),
                });
                if let Some(label) = label {
                    value["label"] = json!(label);
                }
                value
            }
            Self::FarmPortfolio { as_of } => {
                let mut value = json!({"plan": "farm_portfolio"});
                if let Some(as_of) = as_of {
                    value["as_of"] = json!(day(*as_of));
                }
                value
            }
            Self::FarmComparison { selectors, as_of } => {
                let selectors: Vec<Value> = selectors
                    .iter()
                    .map(|selector| match selector {
                        FarmSelector::Id(id) => json!({"id": id}),
                        FarmSelector::Reference(reference) => json!({"reference": reference}),
                    })
                    .collect();
                let mut value = json!({"plan": "farm_comparison", "selectors": selectors});
                if let Some(as_of) = as_of {
                    value["as_of"] = json!(day(*as_of));
                }
                value
            }
            Self::SupportRecord { target, id } => {
                json!({"plan": "support_record", "target": target.as_str(), "id": id.to_string()})
            }
            Self::Guide => json!({"plan": "guide"}),
            Self::Semantic => json!({"plan": "semantic"}),
            Self::Handoff {
                skill,
                period,
                module,
                focus,
            } => {
                let mut value = json!({"plan": "handoff", "skill": skill});
                if let Some(period) = period {
                    value["from"] = json!(day(period.from));
                    value["through"] = json!(day(period.through));
                }
                if let Some(module) = module {
                    value["module"] = json!(module);
                }
                if let Some(focus) = focus {
                    value["focus"] = json!(focus);
                }
                value
            }
            Self::Clarify { missing, choices } => {
                let mut value = json!({"plan": "clarify", "missing": missing.as_str()});
                if !choices.is_empty() {
                    let choices: Vec<Value> = choices
                        .iter()
                        .map(|choice| json!({"label": choice.label, "resend": choice.resend}))
                        .collect();
                    value["choices"] = json!(choices);
                }
                value
            }
        }
    }
}

/// What the page tells the planner. Page labels never establish facts; they
/// only disambiguate generic words such as "order".
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct PlanUi<'a> {
    pub module: Option<&'a str>,
    pub entity_type: Option<&'a str>,
    pub entity_id: Option<&'a str>,
    pub explicit_record: bool,
}

/// Hook for a future router model. The lexicon planner calls it only when it
/// could not place a question. The default answers `Semantic`, which keeps the
/// existing retrieval-and-generation path.
pub(crate) trait PlanFallback: Send + Sync {
    fn plan_fallback(&self, query: &str, locale: Option<&str>, ui: &PlanUi<'_>) -> ReadPlan;
}

pub(crate) struct SemanticFallback;

impl PlanFallback for SemanticFallback {
    fn plan_fallback(&self, _query: &str, _locale: Option<&str>, _ui: &PlanUi<'_>) -> ReadPlan {
        ReadPlan::Semantic
    }
}

pub(crate) fn plan(query: &str, locale: Option<&str>, ui: &PlanUi<'_>) -> ReadPlan {
    plan_at(
        query,
        locale,
        ui,
        chrono::Utc::now().date_naive(),
        &SemanticFallback,
    )
}

pub(crate) fn plan_at(
    query: &str,
    locale: Option<&str>,
    ui: &PlanUi<'_>,
    today: NaiveDate,
    fallback: &dyn PlanFallback,
) -> ReadPlan {
    let lex = lexicon::for_locale(locale);
    let prompt = query.trim().trim_end_matches(['.', '?', '!']).trim();
    if prompt.is_empty() || prompt.len() > 512 {
        return ReadPlan::Semantic;
    }
    if let Some(plan) = support_record(lex, prompt) {
        return plan;
    }
    if let Some(plan) = farm(lex, prompt) {
        return plan;
    }
    if let Some(plan) = sales(lex, prompt, today) {
        return plan;
    }
    if let Some((kind, locator)) = record_lookup::parse_lookup_in(lex, query, ui.module, true) {
        return ReadPlan::Record { kind, locator };
    }
    let folded = Folded::new(prompt);
    if let Some((_, skill)) = lex.skills.iter().find(|(phrase, _)| folded.has(phrase)) {
        return ReadPlan::Handoff {
            skill: *skill,
            period: parse_period(lex, prompt, today),
            module: ui.module.map(str::to_owned),
            focus: None,
        };
    }
    if folded.folded.split(' ').count() <= 12 && folded.has_any(&lex.reference_words) {
        return ReadPlan::FollowUp;
    }
    if folded.strip_start_any(&lex.guide_triggers).is_some() {
        return ReadPlan::Guide;
    }
    fallback.plan_fallback(query, locale, ui)
}

// ----- shared helpers --------------------------------------------------------

/// Remove a leading lexicon term and following whitespace.
fn strip_word<'a>(text: &'a str, terms: &[String]) -> Option<&'a str> {
    terms.iter().find_map(|term| {
        let rest = text.strip_prefix(term.as_str())?;
        let word_end = term.chars().next_back().is_some_and(lexicon::is_word);
        if word_end && rest.chars().next().is_some_and(lexicon::is_word) {
            return None;
        }
        Some(rest.trim_start())
    })
}

fn is_history_date(text: &str) -> Option<NaiveDate> {
    let bytes = text.as_bytes();
    let shaped = bytes.len() == 10
        && bytes.iter().enumerate().all(|(index, byte)| {
            matches!(index, 4 | 7) == (*byte == b'-') && (*byte == b'-' || byte.is_ascii_digit())
        });
    if !shaped {
        return None;
    }
    NaiveDate::parse_from_str(text, "%Y-%m-%d").ok()
}

// ----- support records -------------------------------------------------------

fn support_record(lex: &Merged, prompt: &str) -> Option<ReadPlan> {
    let folded = Folded::new(prompt).folded;
    let mut rest = strip_word(&folded, &lex.support_read_prefixes)?;
    if let Some(after) = strip_word(rest, &lex.support_articles) {
        rest = after;
    }
    if let Some(after) = strip_word(rest, &lex.support_detail_words) {
        rest = after;
    }
    if let Some(after) = strip_word(rest, &lex.support_articles) {
        rest = after;
    }
    let targets = [
        (SupportTarget::Approval, &lex.support_approval),
        (SupportTarget::CalendarEvent, &lex.support_calendar),
        (SupportTarget::Document, &lex.support_document),
    ];
    let (target, after) = targets.iter().find_map(|(target, terms)| {
        strip_word(rest, terms.as_slice()).map(|after| (*target, after))
    })?;
    let mut rest = after;
    if let Some(after) = strip_word(rest, &lex.support_id_words) {
        rest = after;
    }
    let rest = rest.strip_prefix('#').unwrap_or(rest).trim_start();
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() || digits.len() > 20 || digits.starts_with('0') {
        return None;
    }
    let tail = rest[digits.len()..].trim();
    if !(tail.is_empty() || lex.support_suffix_words.iter().any(|word| word == tail)) {
        return None;
    }
    let id: u64 = digits.parse().ok()?;
    Some(ReadPlan::SupportRecord { target, id })
}

// ----- farm ------------------------------------------------------------------

fn valid_record_id(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 19
        && !text.starts_with('0')
        && text.bytes().all(|b| b.is_ascii_digit())
        && text.parse::<i64>().is_ok()
}

fn clean_reference(text: &str) -> bool {
    !text.is_empty() && text.len() <= 128 && !text.chars().any(|c| c.is_control() || c == '"')
}

/// `Some(selector)` for a usable target, `None` when it names no one batch.
fn farm_selector(lex: &Merged, text: &str) -> Option<FarmSelector> {
    let text = text.trim();
    if let Some(inner) = text.strip_prefix('"').and_then(|t| t.strip_suffix('"')) {
        let inner = inner.trim();
        return clean_reference(inner).then(|| FarmSelector::Reference(inner.to_owned()));
    }
    let id = text.strip_prefix('#').map_or(text, str::trim_start);
    if valid_record_id(id) {
        return Some(FarmSelector::Id(id.to_owned()));
    }
    let folded = Folded::new(text).folded;
    let first = folded.split(' ').next().unwrap_or_default();
    let general = lex.farm_all.iter().any(|word| word == first)
        || lex.reference_words.iter().any(|word| word == first);
    if text.starts_with('#')
        || text.bytes().all(|b| b.is_ascii_digit())
        || general
        || !clean_reference(text)
    {
        return None;
    }
    Some(FarmSelector::Reference(text.to_owned()))
}

/// Split `<head> as of <token>` using the lexicon's "as of" phrases.
fn split_as_of<'a>(lex: &Merged, folded: &'a str) -> (&'a str, Option<&'a str>) {
    if let Some((head, token)) = folded.rsplit_once(' ') {
        for term in &lex.as_of {
            if let Some(prefix) = head.strip_suffix(term.as_str()) {
                if prefix.is_empty() || prefix.ends_with(' ') {
                    return (prefix.trim_end(), Some(token));
                }
            }
        }
    }
    (folded, None)
}

/// Items of `#12 and "East"` style lists: ids or quoted references only.
fn compare_items(lex: &Merged, target: &str) -> Option<Vec<String>> {
    let mut items = Vec::new();
    let mut rest = target.trim();
    loop {
        let item_end = if let Some(inner) = rest.strip_prefix('"') {
            let close = inner.find('"')?;
            if inner[..close].trim().is_empty() || inner[..close].contains(['\r', '\n']) {
                return None;
            }
            close + 2
        } else {
            let body = rest.strip_prefix('#').unwrap_or(rest);
            let digits = body.bytes().take_while(u8::is_ascii_digit).count();
            if digits == 0 || body.starts_with('0') {
                return None;
            }
            rest.len() - body.len() + digits
        };
        items.push(rest[..item_end].to_owned());
        rest = rest[item_end..].trim_start();
        if rest.is_empty() {
            break;
        }
        if let Some(after) = rest.strip_prefix(',') {
            rest = after.trim_start();
            let word_end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            let word = Folded::new(&rest[..word_end]).folded;
            if lex.farm_conjunctions.contains(&word) {
                rest = rest[word_end..].trim_start();
            }
        } else {
            let word_end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            let word = Folded::new(&rest[..word_end]).folded;
            if !lex.farm_conjunctions.contains(&word) {
                return None;
            }
            rest = rest[word_end..].trim_start();
        }
    }
    (2..=5).contains(&items.len()).then_some(items)
}

fn farm(lex: &Merged, prompt: &str) -> Option<ReadPlan> {
    let f = Folded::new(prompt);
    if f.strip_start_any(&lex.mutation_verbs).is_some() {
        return None;
    }
    let (body, as_of_token) = split_as_of(lex, &f.folded);
    let after_show = strip_word(body, &lex.show_verbs).unwrap_or(body);
    // Portfolio: "<metrics> for all <batches>".
    let portfolio = Folded::new(body);
    let has_digit = body.bytes().any(|b| b.is_ascii_digit());
    let is_portfolio = !has_digit
        && !body.contains('"')
        && portfolio.has_any(&lex.farm_metrics)
        && portfolio.has_any(&lex.farm_all)
        && portfolio.has_any(&lex.farm_batch)
        && !portfolio.has_any(&lex.farm_compare);
    // Comparison: "compare <batches> <list>".
    let comparison = strip_word(body, &lex.farm_compare)
        .and_then(|after| strip_word(after, &lex.farm_batch).map(|list| (after, list)));
    // Single batch: "[show] metrics for [the] <batch> <target>".
    let single = strip_word(after_show, &lex.farm_metrics)
        .and_then(|after| strip_word(after, &lex.label_prepositions))
        .map(|after| strip_word(after, &lex.farm_articles).unwrap_or(after))
        .and_then(|after| strip_word(after, &lex.farm_batch));
    if !is_portfolio && comparison.is_none() && single.is_none() {
        return None;
    }
    let as_of = match as_of_token {
        None => None,
        Some(token) => match is_history_date(token) {
            Some(date) => Some(date),
            None => {
                return Some(ReadPlan::Clarify {
                    missing: Missing::FarmDate,
                    choices: Vec::new(),
                })
            }
        },
    };
    if is_portfolio {
        return Some(ReadPlan::FarmPortfolio { as_of });
    }
    // Targets keep the user's capitalization: slice the original text.
    let original_target = |rest: &str| -> String {
        let start = f.original(body.len() - rest.len());
        let end = f.original(body.len());
        f.text[start..end].to_owned()
    };
    if let Some((_, list)) = comparison {
        let target = original_target(list);
        let Some(items) = compare_items(lex, &target) else {
            return Some(ReadPlan::Clarify {
                missing: Missing::FarmCompare,
                choices: Vec::new(),
            });
        };
        let selectors: Vec<FarmSelector> = items
            .iter()
            .filter_map(|item| farm_selector(lex, item))
            .collect();
        return Some(if selectors.len() == items.len() {
            ReadPlan::FarmComparison { selectors, as_of }
        } else {
            ReadPlan::Clarify {
                missing: Missing::FarmSelectors,
                choices: Vec::new(),
            }
        });
    }
    let target = original_target(single?);
    let selector = farm_selector(lex, &target)?;
    Some(ReadPlan::FarmComparison {
        selectors: vec![selector],
        as_of,
    })
}

// ----- sales summaries -------------------------------------------------------

fn tokens(text: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    for (index, c) in text.char_indices() {
        if c.is_alphanumeric() {
            if start.is_none() {
                start = Some(index);
            }
        } else if let Some(begin) = start.take() {
            out.push((begin, index));
        }
    }
    if let Some(begin) = start {
        out.push((begin, text.len()));
    }
    out
}

fn is_year(token: &str) -> Option<i32> {
    (token.len() == 4 && token.bytes().all(|b| b.is_ascii_digit()))
        .then(|| token.parse().ok())
        .flatten()
}

fn month_range(year: i32, month: u32) -> Option<DateRange> {
    let from = NaiveDate::from_ymd_opt(year, month, 1)?;
    let next = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)?
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)?
    };
    Some(DateRange {
        from,
        through: next.pred_opt()?,
    })
}

/// ISO dates (`2024-04-09`) with their byte ranges, on word boundaries.
fn iso_dates(text: &str) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut index = 0;
    while index + 10 <= bytes.len() {
        let slice = &bytes[index..index + 10];
        let shaped = slice.iter().enumerate().all(|(i, b)| {
            if matches!(i, 4 | 7) {
                *b == b'-'
            } else {
                b.is_ascii_digit()
            }
        });
        let before_ok =
            index == 0 || !(bytes[index - 1].is_ascii_alphanumeric() || bytes[index - 1] == b'_');
        let after_ok = index + 10 == bytes.len()
            || !(bytes[index + 10].is_ascii_alphanumeric() || bytes[index + 10] == b'_');
        if shaped && before_ok && after_ok {
            out.push((index, index + 10));
            index += 10;
        } else {
            index += 1;
        }
    }
    out
}

/// One exact reporting period, or `None` when the text names none, several, or
/// an invalid one.
pub(crate) fn parse_period(lex: &Merged, text: &str, today: NaiveDate) -> Option<DateRange> {
    let folded = Folded::new(text).folded;
    let has_range_word = folded_has_any(&folded, &lex.range_words);
    let dates = iso_dates(&folded);
    if !dates.is_empty() {
        if dates.len() > 2 {
            return None;
        }
        let parsed: Vec<NaiveDate> = dates
            .iter()
            .map(|(start, end)| NaiveDate::parse_from_str(&folded[*start..*end], "%Y-%m-%d").ok())
            .collect::<Option<Vec<_>>>()?;
        if parsed.len() == 2 {
            let between = folded[dates[0].1..dates[1].0].trim();
            if !lex.range_connectors.iter().any(|term| term == between) {
                return None;
            }
        } else if has_range_word {
            return None;
        }
        let from = parsed[0];
        let through = *parsed.last()?;
        return (from <= through).then_some(DateRange { from, through });
    }
    if has_range_word {
        return None;
    }
    let spans = tokens(&folded);
    let words: Vec<&str> = spans.iter().map(|(s, e)| &folded[*s..*e]).collect();
    let mut hits: Vec<DateRange> = Vec::new();
    for (index, (start, end)) in spans.iter().enumerate() {
        let word = &folded[*start..*end];
        // 2024-04
        if let Some(year) = is_year(word) {
            let next = folded[*end..].strip_prefix('-');
            if let Some(tail) = next {
                let digits: String = tail.chars().take_while(|c| c.is_ascii_digit()).collect();
                if digits.len() == 2 {
                    let month: u32 = digits.parse().ok()?;
                    hits.push(month_range(year, month)?);
                    continue;
                }
            }
        }
        // April 2024, avril 2024, abril de 2024
        if let Some((_, month)) = lex.months.iter().find(|(name, _)| name == word) {
            let mut next = index + 1;
            while words
                .get(next)
                .is_some_and(|candidate| lex.date_glue.iter().any(|glue| glue == candidate))
            {
                next += 1;
            }
            if let Some(year) = words.get(next).and_then(|candidate| is_year(candidate)) {
                hits.push(month_range(year, *month)?);
            }
            continue;
        }
        // in 2024, during 2024
        if lex.year_prepositions.iter().any(|term| term == word) {
            if let Some(year) = words
                .get(index + 1)
                .and_then(|candidate| is_year(candidate))
            {
                let after_year = spans.get(index + 1).map_or(0, |(_, e)| *e);
                if !folded[after_year..].starts_with('-') {
                    hits.push(DateRange {
                        from: NaiveDate::from_ymd_opt(year, 1, 1)?,
                        through: NaiveDate::from_ymd_opt(year, 12, 31)?,
                    });
                }
            }
        }
    }
    for (term, unit, offset) in &lex.relative_periods {
        if lexicon::find_phrase(&folded, term).is_some() {
            let range = match unit {
                PeriodUnit::Month => {
                    let total = today.year() * 12 + today.month0() as i32 + offset;
                    month_range(total.div_euclid(12), total.rem_euclid(12) as u32 + 1)?
                }
                PeriodUnit::Year => {
                    let year = today.year() + offset;
                    DateRange {
                        from: NaiveDate::from_ymd_opt(year, 1, 1)?,
                        through: NaiveDate::from_ymd_opt(year, 12, 31)?,
                    }
                }
            };
            hits.push(range);
            break;
        }
    }
    (hits.len() == 1).then(|| hits[0])
}

fn folded_has_any(folded: &str, terms: &[String]) -> bool {
    terms
        .iter()
        .any(|term| lexicon::find_phrase(folded, term).is_some())
}

fn strip_quoted(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut inside = false;
    for c in text.chars() {
        if c == '"' {
            inside = !inside;
            continue;
        }
        if !inside {
            out.push(c);
        }
    }
    out
}

/// A label that follows a "for"/"at" word: `for "Kicukiro East"`.
fn quoted_label(lex: &Merged, prompt: &str) -> Option<String> {
    let mut search = 0;
    while let Some(offset) = prompt[search..].find('"') {
        let open = search + offset;
        let close = open + 1 + prompt[open + 1..].find('"')?;
        let before = Folded::new(prompt[..open].trim_end()).folded;
        let last = before.rsplit(' ').next().unwrap_or_default();
        if lex.label_prepositions.iter().any(|term| term == last) {
            return Some(prompt[open + 1..close].trim().to_owned());
        }
        search = close + 1;
    }
    None
}

/// An unquoted label after "for"/"at", up to the next period word.
fn unquoted_label(lex: &Merged, prompt: &str) -> Option<String> {
    let f = Folded::new(prompt);
    let (_, after_prep) = lex
        .label_prepositions
        .iter()
        .filter_map(|term| f.find(term))
        .min_by_key(|(start, _)| *start)?;
    let tail = &f.text[after_prep..];
    let tail_folded = Folded::new(tail);
    let stops = lex
        .range_words
        .iter()
        .chain(&lex.year_prepositions)
        .chain(&lex.on)
        .chain(&lex.as_of);
    let end = stops
        .filter_map(|term| tail_folded.find(term).map(|(start, _)| start))
        .filter(|start| *start > 0)
        .min()
        .unwrap_or(tail.len());
    let label = tail[..end].trim().trim_matches(['.', ':', ',']);
    (!label.is_empty()).then(|| label.to_owned())
}

fn period_target(lex: &Merged, label: &str) -> bool {
    let f = Folded::new(label);
    let first = f.folded.split(' ').next().unwrap_or_default();
    is_year(first).is_some()
        || lex.months.iter().any(|(name, _)| name == first)
        || lex.all_scope.iter().any(|term| *term == f.folded)
        || lex
            .relative_periods
            .iter()
            .any(|(term, _, _)| f.folded.starts_with(term.as_str()))
}

fn sales(lex: &Merged, prompt: &str, today: NaiveDate) -> Option<ReadPlan> {
    let syntax = strip_quoted(prompt);
    // "shop-sales" and "shop sales" are the same phrase.
    let source_text = Folded::new(&syntax.replace('-', " "));
    let shop = source_text.has_any(&lex.shop);
    let customer = source_text.has_any(&lex.customer);
    let historical = source_text.has_any(&lex.historical);
    let totals = source_text.has_any(&lex.totals);
    let period = parse_period(lex, &syntax, today);
    let leading = Folded::new(prompt);
    let starts_with_show = leading.strip_start_any(&lex.show_verbs).is_some();
    if !(shop || customer || historical)
        || !(totals || (period.is_some() && starts_with_show))
        || leading.strip_start_any(&lex.mutation_verbs).is_some()
        || leading.has_any(&lex.modifiers)
    {
        return None;
    }
    if shop == customer {
        return Some(ReadPlan::Clarify {
            missing: Missing::Source,
            choices: Vec::new(),
        });
    }
    let Some(range) = period else {
        return Some(ReadPlan::Clarify {
            missing: Missing::Period,
            choices: Vec::new(),
        });
    };
    let quote_count = prompt.matches('"').count();
    let quoted = quoted_label(lex, prompt);
    let label = match &quoted {
        Some(label) => {
            if quote_count != 2 || label.is_empty() || !clean_label(label) {
                return Some(ReadPlan::Clarify {
                    missing: Missing::LabelQuotes,
                    choices: Vec::new(),
                });
            }
            Some(label.clone())
        }
        None => {
            if quote_count != 0 {
                return Some(ReadPlan::Clarify {
                    missing: Missing::LabelQuotes,
                    choices: Vec::new(),
                });
            }
            match unquoted_label(lex, prompt) {
                Some(label) if period_target(lex, &label) => None,
                Some(label) => {
                    if !clean_label(&label) || label.split_whitespace().count() > 6 {
                        return Some(ReadPlan::Clarify {
                            missing: Missing::LabelQuotes,
                            choices: Vec::new(),
                        });
                    }
                    Some(label)
                }
                None => None,
            }
        }
    };
    Some(ReadPlan::PeriodSummary {
        module: if shop {
            SalesModule::ShopSales
        } else {
            SalesModule::Sales
        },
        range,
        label,
    })
}

fn clean_label(label: &str) -> bool {
    !label.chars().any(char::is_control) && label.len() <= 256
}
