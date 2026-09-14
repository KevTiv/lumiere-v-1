//! Non-progress detection for the governed loop (AIH-22, plan §8.2).
//!
//! The loop makes progress when a tool call returns evidence this run has not
//! seen before. Results that repeat evidence already in the run are bounded:
//! after `limit` consecutive such results the loop stops with a recorded
//! non-progress outcome instead of spending further rounds and budget. This
//! covers both shapes the plan names, the same call repeated and different
//! calls that keep returning the same empty result.
//!
//! Evidence is the whole protected tool result, so a changed prompt, model or
//! provider is not progress by itself, and superficial argument edits
//! (whitespace, key order) normalize to the same call fingerprint.
//!
//! Deferred: a per-tool polling policy with its own attempt, time and backoff
//! bounds. The capability contract carries no polling metadata yet, so one
//! bounded allowance covers legitimate short polling, and it consumes the same
//! task budget as any other call.

use std::collections::HashSet;

use serde_json::{json, Value};

use crate::{
    providers::llm::ToolCallRequest,
    tools::types::{hash_tool_input, ToolOutput},
};

/// Consecutive unchanged results tolerated before the loop stops.
pub(super) const MAX_UNCHANGED_RESULTS: u32 = 8;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Progress {
    /// The result carries evidence new to this run.
    New,
    /// Already-seen evidence, still inside the allowance.
    Unchanged { consecutive: u32 },
    /// Already-seen evidence past the allowance; the loop must stop.
    Stalled { consecutive: u32 },
}

pub(super) struct ProgressTracker {
    limit: u32,
    seen_evidence: HashSet<String>,
    consecutive_unchanged: u32,
}

impl ProgressTracker {
    pub fn new(limit: u32) -> Self {
        Self {
            limit,
            seen_evidence: HashSet::new(),
            consecutive_unchanged: 0,
        }
    }

    /// Record one protected tool result and classify the run's progress.
    pub fn observe(&mut self, output: &ToolOutput) -> Progress {
        if self.seen_evidence.insert(evidence_fingerprint(output)) {
            self.consecutive_unchanged = 0;
            return Progress::New;
        }
        let consecutive = self.consecutive_unchanged.saturating_add(1);
        self.consecutive_unchanged = consecutive;
        if consecutive > self.limit {
            Progress::Stalled { consecutive }
        } else {
            Progress::Unchanged { consecutive }
        }
    }
}

/// Stable identity of a call: its tool and normalized arguments. Recorded with
/// a non-progress outcome so the stalled call is reviewable.
pub(super) fn call_fingerprint(call: &ToolCallRequest) -> String {
    hash_tool_input(&json!({
        "tool": call.name.trim(),
        "arguments": normalize(&call.arguments),
    }))
}

fn evidence_fingerprint(output: &ToolOutput) -> String {
    hash_tool_input(&json!({
        "summary": output.summary.trim(),
        "data": normalize(&output.data),
        "citations": output.citations,
        "row_count": output.row_count,
    }))
}

/// Trim string content so cosmetic edits do not read as different values.
/// `serde_json` maps are ordered, so key order is already canonical.
fn normalize(value: &Value) -> Value {
    match value {
        Value::String(text) => Value::String(text.trim().to_string()),
        Value::Array(items) => Value::Array(items.iter().map(normalize).collect()),
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, field)| (key.trim().to_string(), normalize(field)))
                .collect(),
        ),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn output(summary: &str, data: Value) -> ToolOutput {
        ToolOutput {
            summary: summary.to_string(),
            data,
            citations: Vec::new(),
            row_count: None,
        }
    }

    fn call(name: &str, arguments: Value) -> ToolCallRequest {
        ToolCallRequest {
            id: Some("c1".into()),
            name: name.to_string(),
            arguments,
            arguments_error: None,
        }
    }

    #[test]
    fn new_evidence_is_progress_and_resets_the_allowance() {
        let mut tracker = ProgressTracker::new(1);
        assert_eq!(tracker.observe(&output("rows", json!([1]))), Progress::New);
        assert_eq!(
            tracker.observe(&output("rows", json!([1]))),
            Progress::Unchanged { consecutive: 1 }
        );
        assert_eq!(tracker.observe(&output("rows", json!([2]))), Progress::New);
        assert_eq!(
            tracker.observe(&output("rows", json!([1]))),
            Progress::Unchanged { consecutive: 1 },
            "the allowance restarts after real progress"
        );
    }

    #[test]
    fn repeated_seen_evidence_stalls_past_the_allowance() {
        let mut tracker = ProgressTracker::new(2);
        let empty = output("no results", json!([]));
        assert_eq!(tracker.observe(&empty), Progress::New);
        assert_eq!(
            tracker.observe(&empty),
            Progress::Unchanged { consecutive: 1 }
        );
        assert_eq!(
            tracker.observe(&empty),
            Progress::Unchanged { consecutive: 2 },
            "bounded polling stays inside the allowance"
        );
        assert_eq!(
            tracker.observe(&empty),
            Progress::Stalled { consecutive: 3 }
        );
    }

    #[test]
    fn different_calls_returning_the_same_empty_result_are_not_progress() {
        let mut tracker = ProgressTracker::new(1);
        let empty = output("no results", json!([]));
        assert_eq!(tracker.observe(&empty), Progress::New);
        // A second search with a different query but the same empty result
        // adds no evidence, so it does not reset the allowance.
        assert_eq!(
            tracker.observe(&empty),
            Progress::Unchanged { consecutive: 1 }
        );
        assert_eq!(
            tracker.observe(&empty),
            Progress::Stalled { consecutive: 2 }
        );
    }

    #[test]
    fn fingerprints_ignore_cosmetic_differences_only() {
        let spaced = call("search", json!({"query": "  laptops ", "limit": 5}));
        let tight = call("search", json!({"limit": 5, "query": "laptops"}));
        assert_eq!(call_fingerprint(&spaced), call_fingerprint(&tight));
        let other_value = call("search", json!({"query": "laptop", "limit": 5}));
        assert_ne!(call_fingerprint(&spaced), call_fingerprint(&other_value));
        let other_tool = call("lookup", json!({"query": "laptops", "limit": 5}));
        assert_ne!(call_fingerprint(&tight), call_fingerprint(&other_tool));

        assert_eq!(
            evidence_fingerprint(&output(" rows ", json!({"a": " x "}))),
            evidence_fingerprint(&output("rows", json!({"a": "x"})))
        );
        assert_ne!(
            evidence_fingerprint(&output("rows", json!({"a": "x"}))),
            evidence_fingerprint(&output("rows", json!({"a": "y"})))
        );
    }
}
