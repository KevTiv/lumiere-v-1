use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

fn scope() -> Scope {
    Scope {
        environment_id: "test".into(),
        actor_id: "actor".into(),
        organization_id: "7".into(),
        company_id: Some("9".into()),
        authorization_version: "auth".into(),
    }
}

struct Source {
    heads: Vec<u64>,
    reads: AtomicUsize,
    rows: Vec<Value>,
    snapshot_versions: Vec<Vec<Value>>,
    commits: Vec<Vec<Value>>,
    missing: bool,
}
impl CategorySource for Source {
    async fn watermark(&self) -> Result<u64, FeedError> {
        let read = self.reads.fetch_add(1, Ordering::Relaxed);
        Ok(*self
            .heads
            .get(read)
            .unwrap_or_else(|| self.heads.last().unwrap()))
    }
    async fn snapshot_rows(&self) -> Result<Vec<Value>, FeedError> {
        Ok(self
            .snapshot_versions
            .get(self.reads.load(Ordering::Relaxed) / 2)
            .unwrap_or(&self.rows)
            .clone())
    }
    async fn commit_changes(&self, sequence: u64) -> Result<Vec<Value>, FeedError> {
        if self.missing {
            return Err(FeedError::Reset);
        }
        self.commits
            .get(sequence as usize - 1)
            .cloned()
            .ok_or(FeedError::Reset)
    }
}
fn source(heads: Vec<u64>) -> Source {
    Source {
        heads,
        reads: AtomicUsize::new(0),
        rows: vec![json!({"id":"1"})],
        snapshot_versions: vec![],
        commits: vec![],
        missing: false,
    }
}

#[tokio::test]
async fn consistent_snapshot_carries_exact_watermark() {
    let value = snapshot(&source(vec![3, 3]), &scope(), "schema")
        .await
        .unwrap();
    assert_eq!(value["cursor"], "3");
    assert_eq!(value["rows"], json!([{"id":"1"}]));
}
#[tokio::test]
async fn mutation_during_snapshot_requires_a_new_stable_read() {
    let mut source = source(vec![3, 4, 4, 4]);
    source.snapshot_versions = vec![
        vec![json!({"id":"1","name":"before"})],
        vec![json!({"id":"1","name":"after"})],
    ];
    let result = snapshot(&source, &scope(), "schema").await.unwrap();
    assert_eq!(result["cursor"], "4");
    assert_eq!(result["rows"], json!([{"id":"1","name":"after"}]));
    assert_eq!(source.reads.load(Ordering::Relaxed), 4);
}
#[tokio::test]
async fn oversized_snapshot_never_activates() {
    let mut source = source(vec![1]);
    source.rows = vec![json!({"id":"1"}); 1001];
    assert!(matches!(
        snapshot(&source, &scope(), "schema").await,
        Err(FeedError::Reset)
    ));
}
#[tokio::test]
async fn continuous_mutation_is_unavailable_never_partial_success() {
    assert!(matches!(
        snapshot(&source(vec![1, 2, 3, 4, 5, 6]), &scope(), "schema").await,
        Err(FeedError::Unavailable)
    ));
}
#[tokio::test]
async fn page_never_splits_a_multirow_commit() {
    let mut source = source(vec![2]);
    source.commits = vec![
        vec![json!({"operation":"delete", "id":"1"}); 700],
        vec![json!({"operation":"delete", "id":"2"}); 400],
    ];
    let first = pull(&source, &scope(), "schema", 0).await.unwrap();
    assert_eq!(first["changes"].as_array().unwrap().len(), 700);
    assert_eq!(first["nextCursor"], "1");
    assert_eq!(first["hasMore"], true);
    let second = pull(&source, &scope(), "schema", 1).await.unwrap();
    assert_eq!(second["changes"].as_array().unwrap().len(), 400);
    assert_eq!(second["nextCursor"], "2");
}
#[tokio::test]
async fn retained_gap_demands_resnapshot_without_cursor_advance() {
    let mut source = source(vec![4]);
    source.missing = true;
    assert!(matches!(
        pull(&source, &scope(), "schema", 1).await,
        Err(FeedError::Reset)
    ));
}
#[tokio::test]
async fn empty_filtered_commits_still_advance_bounded_progress() {
    let mut source = source(vec![21]);
    source.commits = vec![vec![]; 21];
    let page = pull(&source, &scope(), "schema", 0).await.unwrap();
    assert_eq!(page["nextCursor"], "20");
    assert_eq!(page["hasMore"], true);
    assert_eq!(page["changes"], json!([]));
}
#[tokio::test]
async fn oversized_commit_and_future_cursor_demand_reset() {
    let mut source = source(vec![1]);
    source.commits = vec![vec![json!({"id":"1"}); 1001]];
    assert!(matches!(
        pull(&source, &scope(), "schema", 0).await,
        Err(FeedError::Reset)
    ));
    assert!(matches!(
        pull(&source, &scope(), "schema", 2).await,
        Err(FeedError::Reset)
    ));
}
#[test]
fn cursor_is_exact_and_bounded() {
    assert_eq!(parse_cursor("18446744073709551615").unwrap(), u64::MAX);
    for bad in ["", "01", "-1", "1; DELETE", "18446744073709551616"] {
        assert!(parse_cursor(bad).is_err());
    }
}
