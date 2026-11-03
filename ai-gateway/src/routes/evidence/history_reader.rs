//! Newest-first history over SpacetimeDB's unordered HTTP SQL interface.
//!
//! An unordered `LIMIT` is never sorted and treated as a complete page. Scoped
//! existence probes locate a complete numeric-ID window before its rows are
//! sorted. Sparse histories may return a shorter page with a continuation.

use async_trait::async_trait;
use serde_json::Value;
use std::collections::HashSet;
use std::time::Duration;
use stdb_client::StdbClient;
use tokio::time::{timeout_at, Instant};

use crate::error::{AppError, AppResult};

const MAX_HISTORY_QUERIES: usize = 128;
// The API's gateway forward has a 15s timeout. Leave time for the actor grant,
// optional economics enrichment and response encoding, even for sparse IDs.
const HISTORY_READ_TIMEOUT: Duration = Duration::from_secs(6);
const HISTORY_COLUMNS: &str = "id, organization_id, company_id, status, skill_id, agent_id, step_count, tokens_used, started_at, completed_at";

pub(super) struct HistoryPage {
    pub rows: Vec<Value>,
    pub has_more: bool,
}

struct QueryBudget {
    remaining: usize,
    deadline: Instant,
}

#[async_trait]
trait HistorySource: Sync {
    async fn rows(
        &self,
        lower: u64,
        upper: u64,
        limit: usize,
        ids_only: bool,
    ) -> AppResult<Vec<Value>>;
}

struct ScopedHistory<'a> {
    stdb: &'a StdbClient,
    organization_id: u64,
    company_id: u64,
}

fn history_sql(
    organization_id: u64,
    company_id: u64,
    lower: u64,
    upper: u64,
    limit: usize,
    ids_only: bool,
) -> String {
    let columns = if ids_only {
        "id, organization_id, company_id"
    } else {
        HISTORY_COLUMNS
    };
    format!("SELECT {columns} FROM ai_agent_run WHERE organization_id = {organization_id} AND company_id = {company_id} AND id >= {lower} AND id <= {upper} LIMIT {limit}")
}

fn row_id(row: &Value) -> AppResult<u64> {
    super::row_u64(row, "id", "id")
        .filter(|id| *id > 0)
        .ok_or_else(|| AppError::Internal("run history row has an invalid id".into()))
}

#[async_trait]
impl HistorySource for ScopedHistory<'_> {
    async fn rows(
        &self,
        lower: u64,
        upper: u64,
        limit: usize,
        ids_only: bool,
    ) -> AppResult<Vec<Value>> {
        let rows = self
            .stdb
            .query_sql(&history_sql(
                self.organization_id,
                self.company_id,
                lower,
                upper,
                limit,
                ids_only,
            ))
            .await
            .map_err(|error| AppError::Internal(format!("read run history: {error}")))?;
        for row in &rows {
            if super::row_u64(row, "organizationId", "organization_id")
                != Some(self.organization_id)
                || super::row_u64(row, "companyId", "company_id") != Some(self.company_id)
            {
                return Err(AppError::Internal(
                    "run history row escaped its scope".into(),
                ));
            }
        }
        Ok(rows)
    }
}

async fn query(
    source: &impl HistorySource,
    budget: &mut QueryBudget,
    lower: u64,
    upper: u64,
    limit: usize,
    ids_only: bool,
) -> AppResult<Option<Vec<Value>>> {
    if budget.remaining == 0 || Instant::now() >= budget.deadline {
        return Ok(None);
    }
    budget.remaining -= 1;
    let rows = match timeout_at(budget.deadline, source.rows(lower, upper, limit, ids_only)).await {
        Ok(result) => result?,
        Err(_) => return Ok(None),
    };
    let mut ids = HashSet::with_capacity(rows.len());
    if rows.len() > limit {
        return Err(AppError::Internal(
            "run history query exceeded its row bound".into(),
        ));
    }
    for row in &rows {
        let id = row_id(row)?;
        if id < lower || id > upper || !ids.insert(id) {
            return Err(AppError::Internal(
                "run history row escaped its ID window".into(),
            ));
        }
    }
    Ok(Some(rows))
}

enum Window {
    Empty,
    Complete { rows: Vec<Value>, next_upper: u64 },
    Budget,
}

fn complete_window(mut rows: Vec<Value>, next_upper: u64) -> Window {
    // The caller read a complete interval of unique, validated integer IDs.
    rows.sort_by_key(|row| std::cmp::Reverse(super::row_u64(row, "id", "id").unwrap_or(0)));
    Window::Complete { rows, next_upper }
}

async fn newest_window(
    source: &impl HistorySource,
    budget: &mut QueryBudget,
    mut upper: u64,
    width: u64,
) -> AppResult<Window> {
    if upper == 0 {
        return Ok(Window::Empty);
    }
    // Following a cursor, dense history normally needs just this one query.
    let top_lower = upper.saturating_sub(width - 1).max(1);
    let Some(rows) = query(source, budget, top_lower, upper, width as usize, false).await? else {
        return Ok(Window::Budget);
    };
    if !rows.is_empty() {
        return Ok(complete_window(rows, top_lower - 1));
    }
    upper = top_lower - 1;
    if upper == 0 {
        return Ok(Window::Empty);
    }
    let Some(witness) = query(source, budget, 1, upper, 1, true).await? else {
        return Ok(Window::Budget);
    };
    let Some(witness) = witness.first() else {
        return Ok(Window::Empty);
    };
    let mut lower = row_id(witness)?;
    // Bracket the newest ID exponentially from an arbitrary witness. This
    // avoids 64 empty probes on every first page when IDs are still small.
    let mut distance = width;
    while upper - lower >= width {
        let threshold = lower.saturating_add(distance).min(upper);
        let Some(rows) = query(source, budget, threshold, upper, 1, true).await? else {
            return Ok(Window::Budget);
        };
        match rows.first() {
            Some(row) => {
                lower = row_id(row)?;
                distance = distance.saturating_mul(2);
            }
            None => {
                upper = threshold - 1;
                break;
            }
        }
    }
    // `lower` is witnessed, and every interval removed from `upper` was proved
    // empty. A witness is never assumed to be the first or last row.
    while upper - lower >= width {
        let midpoint = lower + (upper - lower) / 2 + 1;
        let Some(rows) = query(source, budget, midpoint, upper, 1, true).await? else {
            return Ok(Window::Budget);
        };
        match rows.first() {
            Some(row) => lower = row_id(row)?,
            None => upper = midpoint - 1,
        }
    }
    let Some(rows) = query(source, budget, lower, upper, width as usize, false).await? else {
        return Ok(Window::Budget);
    };
    // The interval contains at most `width` unique integer IDs, so LIMIT cannot
    // omit a row. Sorting this complete window preserves global page ordering.
    Ok(complete_window(rows, lower - 1))
}

async fn read_page(
    source: &impl HistorySource,
    before: Option<u64>,
    limit: usize,
    remaining: usize,
) -> AppResult<HistoryPage> {
    read_page_until(
        source,
        before,
        limit,
        remaining,
        Instant::now() + HISTORY_READ_TIMEOUT,
    )
    .await
}

async fn read_page_until(
    source: &impl HistorySource,
    before: Option<u64>,
    limit: usize,
    remaining: usize,
    deadline: Instant,
) -> AppResult<HistoryPage> {
    let mut budget = QueryBudget {
        remaining,
        deadline,
    };
    let mut upper = before.map_or(u64::MAX, |id| id.saturating_sub(1));
    let target = limit.saturating_add(1);
    let mut rows = Vec::with_capacity(target);
    loop {
        match newest_window(source, &mut budget, upper, target as u64).await? {
            Window::Empty => {
                return Ok(HistoryPage {
                    rows,
                    has_more: false,
                });
            }
            Window::Budget if rows.is_empty() => {
                return Err(AppError::Unavailable(
                    "run history query budget was exhausted; try again".into(),
                ));
            }
            Window::Budget => {
                return Ok(HistoryPage {
                    rows,
                    has_more: true,
                });
            }
            Window::Complete {
                rows: window,
                next_upper,
            } => {
                rows.extend(window.into_iter().take(target - rows.len()));
                if rows.len() == target {
                    rows.truncate(limit);
                    return Ok(HistoryPage {
                        rows,
                        has_more: true,
                    });
                }
                upper = next_upper;
            }
        }
    }
}

pub(super) async fn read_run_history(
    stdb: &StdbClient,
    organization_id: u64,
    company_id: u64,
    before: Option<u64>,
    limit: usize,
) -> AppResult<HistoryPage> {
    read_page(
        &ScopedHistory {
            stdb,
            organization_id,
            company_id,
        },
        before,
        limit,
        MAX_HISTORY_QUERIES,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct UnorderedSource {
        ids: Vec<u64>,
        calls: AtomicUsize,
    }

    impl UnorderedSource {
        fn new(ids: Vec<u64>) -> Self {
            Self {
                ids,
                calls: AtomicUsize::new(0),
            }
        }
    }

    #[async_trait]
    impl HistorySource for UnorderedSource {
        async fn rows(
            &self,
            lower: u64,
            upper: u64,
            limit: usize,
            _ids_only: bool,
        ) -> AppResult<Vec<Value>> {
            self.calls.fetch_add(1, Ordering::Relaxed);
            Ok(self
                .ids
                .iter()
                .copied()
                .filter(|id| *id >= lower && *id <= upper)
                .take(limit)
                .map(|id| json!({"id":id}))
                .collect())
        }
    }

    fn ids(page: &HistoryPage) -> Vec<u64> {
        page.rows
            .iter()
            .map(|row| row_id(row).expect("valid ID"))
            .collect()
    }

    #[tokio::test]
    async fn newest_pages_do_not_sort_an_arbitrary_unordered_sample() {
        let source = UnorderedSource::new(vec![2, 10, 1, 9, 4, 8, 3, 7, 5, 6]);
        let first = read_page(&source, None, 3, MAX_HISTORY_QUERIES)
            .await
            .expect("first page");
        assert_eq!(ids(&first), vec![10, 9, 8]);
        assert!(first.has_more);
        let second = read_page(&source, Some(8), 3, MAX_HISTORY_QUERIES)
            .await
            .expect("second page");
        assert_eq!(ids(&second), vec![7, 6, 5]);
        let last = read_page(&source, Some(2), 3, MAX_HISTORY_QUERIES)
            .await
            .expect("last page");
        assert_eq!(ids(&last), vec![1]);
        assert!(!last.has_more);
    }

    #[tokio::test]
    async fn large_sparse_ids_are_exact_and_budgeted_pages_can_continue() {
        let source = UnorderedSource::new(vec![1, u64::MAX - 2, 1_u64 << 60, u64::MAX]);
        let page = read_page(&source, None, 3, MAX_HISTORY_QUERIES)
            .await
            .expect("large page");
        assert_eq!(ids(&page), vec![u64::MAX, u64::MAX - 2, 1_u64 << 60]);
        assert!(page.has_more);
        assert!(source.calls.load(Ordering::Relaxed) <= MAX_HISTORY_QUERIES);
        let partial = read_page(&source, None, 50, 5)
            .await
            .expect("budgeted partial page");
        assert_eq!(ids(&partial), vec![u64::MAX, u64::MAX - 2]);
        assert!(partial.has_more);
        let last = read_page(&source, Some(1_u64 << 60), 3, MAX_HISTORY_QUERIES)
            .await
            .expect("last sparse page");
        assert_eq!(ids(&last), vec![1]);
        assert!(!last.has_more);
    }

    #[tokio::test]
    async fn exhausted_budget_is_not_reported_as_empty_history() {
        let source = UnorderedSource::new(vec![1]);
        assert!(matches!(
            read_page(&source, None, 3, 1).await,
            Err(AppError::Unavailable(_))
        ));
        assert_eq!(source.calls.load(Ordering::Relaxed), 1);
        let empty = read_page(&UnorderedSource::new(vec![]), None, 3, 2)
            .await
            .expect("empty");
        assert!(empty.rows.is_empty());
        assert!(!empty.has_more);
    }

    #[tokio::test]
    async fn dense_continuation_reads_one_complete_window() {
        let source = UnorderedSource::new((1..=1000).collect());
        let page = read_page(&source, Some(980), 20, MAX_HISTORY_QUERIES)
            .await
            .expect("dense page");
        assert_eq!(ids(&page), (960..=979).rev().collect::<Vec<_>>());
        assert!(page.has_more);
        assert_eq!(source.calls.load(Ordering::Relaxed), 1);
    }

    struct SlowSource {
        immediate_first: bool,
        calls: AtomicUsize,
        completed: AtomicUsize,
    }

    #[async_trait]
    impl HistorySource for SlowSource {
        async fn rows(
            &self,
            _lower: u64,
            _upper: u64,
            _limit: usize,
            _ids_only: bool,
        ) -> AppResult<Vec<Value>> {
            let call = self.calls.fetch_add(1, Ordering::Relaxed);
            if call != 0 || !self.immediate_first {
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
            self.completed.fetch_add(1, Ordering::Relaxed);
            Ok(vec![json!({"id": u64::MAX})])
        }
    }

    #[tokio::test]
    async fn deadline_cancels_slow_query_and_preserves_only_completed_windows() {
        let source = SlowSource {
            immediate_first: true,
            calls: AtomicUsize::new(0),
            completed: AtomicUsize::new(0),
        };
        let started = Instant::now();
        let page = read_page_until(
            &source,
            None,
            3,
            MAX_HISTORY_QUERIES,
            started + Duration::from_millis(20),
        )
        .await
        .expect("partial page before the API timeout");
        assert_eq!(ids(&page), vec![u64::MAX]);
        assert!(page.has_more);
        assert!(started.elapsed() < Duration::from_secs(1));
        assert_eq!(source.calls.load(Ordering::Relaxed), 2);
        assert_eq!(source.completed.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn deadline_before_the_first_window_is_an_error_not_empty_history() {
        let source = SlowSource {
            immediate_first: false,
            calls: AtomicUsize::new(0),
            completed: AtomicUsize::new(0),
        };
        let result = read_page_until(
            &source,
            None,
            3,
            MAX_HISTORY_QUERIES,
            Instant::now() + Duration::from_millis(20),
        )
        .await;
        assert!(matches!(result, Err(AppError::Unavailable(_))));
        assert_eq!(source.completed.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn sql_keeps_exact_scope_and_numeric_bounds_without_order_by() {
        let sql = history_sql(7, 9, 10, 20, 11, false);
        assert!(sql.contains("organization_id = 7 AND company_id = 9"));
        assert!(sql.contains("id >= 10 AND id <= 20 LIMIT 11"));
        assert!(!sql.contains("ORDER BY"));
        assert!(!sql.contains("inputs_json"));
    }
}
