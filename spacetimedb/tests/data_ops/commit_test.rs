//! C2 coverage for a multi-row CSV import reducer.

use spacetimedb::{ReducerContext, Table};

use crate::analytics::reports::analytics_metric;
use crate::core::persistence::{organization_commit, organization_row_change};
use crate::data_ops::analytics_imports::import_analytics_metric_csv;
use crate::data_ops::import_tracker::{import_job, import_job_error};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

pub fn test_analytics_import_records_one_ordered_commit(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let before_commits = ctx
        .db
        .organization_commit()
        .organization_commit_by_org()
        .filter(&fixture.organization_id)
        .count();

    import_analytics_metric_csv(
        ctx,
        fixture.organization_id,
        "name,model\nC2 Metric A,sale.order\n,purchase.order\nC2 Metric B,purchase.order"
            .to_string(),
    )?;

    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .organization_commit_by_org()
        .filter(&fixture.organization_id)
        .collect();
    if commits.len() != before_commits + 1 {
        return Err("analytics import must create exactly one commit".to_string());
    }
    let commit = commits
        .iter()
        .max_by_key(|commit| commit.sequence)
        .ok_or("analytics import commit missing")?;
    let job = ctx
        .db
        .import_job()
        .import_job_by_org()
        .filter(&fixture.organization_id)
        .max_by_key(|job| job.id)
        .ok_or("analytics import job missing")?;
    let mut changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_commit()
        .filter(&fixture.organization_id)
        .filter(|change| change.commit_sequence == commit.sequence)
        .collect();
    changes.sort_by_key(|change| change.ordinal);
    let metrics: Vec<_> = ctx
        .db
        .analytics_metric()
        .iter()
        .filter(|metric| {
            metric.organization_id == fixture.organization_id
                && (metric.name == "C2 Metric A" || metric.name == "C2 Metric B")
        })
        .collect();
    let mut metric_ids: Vec<u64> = metrics.iter().map(|metric| metric.id).collect();
    metric_ids.sort_unstable();
    let import_error = ctx
        .db
        .import_job_error()
        .import_error_by_job()
        .filter(&job.id)
        .next()
        .ok_or("analytics import error row missing")?;
    let job_row_ok = changes.first().is_some_and(|change| {
        change.row_identity_json == format!(r#"{{"id":{}}}"#, job.id)
            && change.row_json.as_deref().is_some_and(|row_json| {
                serde_json::from_str::<serde_json::Value>(row_json)
                    .ok()
                    .is_some_and(|row| {
                        row.get("id").and_then(serde_json::Value::as_u64) == Some(job.id)
                            && row
                                .get("organization_id")
                                .and_then(serde_json::Value::as_u64)
                                == Some(fixture.organization_id)
                            && row.get("status").and_then(serde_json::Value::as_str)
                                == Some("partial")
                            && row.get("imported_rows").and_then(serde_json::Value::as_u64)
                                == Some(2)
                            && row.get("error_rows").and_then(serde_json::Value::as_u64) == Some(1)
                    })
            })
    });
    if metrics.len() != 2
        || commit.operation_id != "erp.import_analytics_metric_csv"
        || commit.row_change_count != 4
        || changes.len() != 4
        || !job_row_ok
        || changes[1].row_identity_json != format!(r#"{{"id":{}}}"#, import_error.id)
        || changes[2].row_identity_json != format!(r#"{{"id":{}}}"#, metric_ids[0])
        || changes[3].row_identity_json != format!(r#"{{"id":{}}}"#, metric_ids[1])
        || changes.iter().enumerate().any(|(ordinal, change)| {
            change.ordinal as usize != ordinal
                || change.table_name
                    != match ordinal {
                        0 => "import_job",
                        1 => "import_job_error",
                        _ => "analytics_metric",
                    }
                || change.organization_id != fixture.organization_id
                || change.change_kind != "upsert"
        })
        || changes[2..].iter().any(|change| {
            serde_json::from_str::<serde_json::Value>(&change.row_identity_json)
                .ok()
                .and_then(|identity| identity.get("id").and_then(serde_json::Value::as_u64))
                .is_none_or(|id| !metrics.iter().any(|metric| metric.id == id))
        })
    {
        return Err("analytics import commit did not preserve exact ordered org rows".to_string());
    }
    Ok(())
}
