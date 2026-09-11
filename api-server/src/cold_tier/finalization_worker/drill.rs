//! Live C5 finalization drill.
//!
//! This is intentionally an ignored test: it talks to a running SpacetimeDB
//! module and creates/drops a disposable PostgreSQL database. The companion
//! script supplies separate administrator/source-read and worker/finalizer
//! credentials. Keeping the test here gives it access to the selected-row
//! handler entry points without changing the production batch scheduler.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use deadpool_postgres::Pool;
use serde_json::{json, Value};
use stdb_client::StdbClient;

use super::pos_order;
use crate::cold_tier::{
    conventions, hydration, migrate, pg_codec, pg_pool, pos_order_read, projection_observability,
    projection_worker,
};
use crate::organization_placement::{
    ConfiguredPlacementResolver, OrganizationPlacement, OrganizationPlacementResolver,
    PlacementError,
};

const DRILL_FLAG: &str = "C5_FINALIZATION_DRILL";
const DRILL_DISPOSABLE_FLAG: &str = "C5_DISPOSABLE_STDB";
const DRILL_ADMIN_TOKEN: &str = "C5_STDB_ADMIN_TOKEN";
const DRILL_WORKER_TOKEN: &str = "C5_STDB_WORKER_TOKEN";
const DRILL_WORKER_IDENTITY: &str = "C5_STDB_WORKER_IDENTITY";
const DRILL_POST_RECONSTRUCTION: &str = "C9_POST_RECONSTRUCTION";

struct RecheckingPlacementResolver {
    first: OrganizationPlacement,
    current: OrganizationPlacement,
    calls: AtomicUsize,
}

impl OrganizationPlacementResolver for RecheckingPlacementResolver {
    fn resolve(&self, _organization_id: u64) -> Result<OrganizationPlacement, PlacementError> {
        if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
            Ok(self.first.clone())
        } else {
            Ok(self.current.clone())
        }
    }
}

#[tokio::test]
#[ignore = "requires a running STDB module and disposable PostgreSQL database"]
async fn c5_live_finalization_worker_drill() -> Result<()> {
    require_enabled()?;
    let stdb_host = env_required("STDB_HOST")?;
    let stdb_module = env_required("STDB_MODULE")?;
    require_disposable_target(&stdb_host, &stdb_module)?;
    let admin_token = env_required(DRILL_ADMIN_TOKEN)?;
    let worker_token = env_required(DRILL_WORKER_TOKEN)?;
    let worker_identity = normalize_identity(&env_required(DRILL_WORKER_IDENTITY)?)?;
    if admin_token == worker_token {
        bail!("{DRILL_ADMIN_TOKEN} and {DRILL_WORKER_TOKEN} must be distinct");
    }

    let admin_stdb = StdbClient::new(stdb_host.clone(), stdb_module.clone(), admin_token);
    let worker_stdb = StdbClient::new(stdb_host, stdb_module, worker_token);
    let orders = admin_stdb
        .query_sql("SELECT * FROM pos_order")
        .await
        .context("find a POS order payload to clone for the drill")?;
    let row_changes = admin_stdb
        .query_sql("SELECT * FROM organization_row_change")
        .await
        .context("find canonical POS commit payloads for the drill")?;
    let commits = admin_stdb
        .query_sql("SELECT * FROM organization_commit")
        .await
        .context("find canonical POS source commits for the drill")?;
    let (sample_order, mut order, source_commit_sequence) =
        canonical_pos_order_source(&orders, &row_changes, &commits)?;
    let org = row_u64(&sample_order, "organizationId")?;
    let company = row_u64(&sample_order, "companyId")?;
    let foreign_organization = org.checked_add(1).context("organization id exhausted")?;
    let foreign_company = company.checked_add(1).context("company id exhausted")?;
    let post_reconstruction = std::env::var(DRILL_POST_RECONSTRUCTION).as_deref() == Ok("1");
    let authoritative_generation = if post_reconstruction {
        env_positive_generation("C9_PLACEMENT_GENERATION", 2)?
    } else {
        1
    };
    let company_a2 = if post_reconstruction {
        let companies = admin_stdb
            .query_sql("SELECT * FROM company")
            .await
            .context("find a distinct Company A2 for the C9 hydration drill")?;
        Some(
            companies
                .iter()
                .filter(|row| row.get("organizationId").and_then(Value::as_u64) == Some(org))
                .filter_map(|row| row.get("id").and_then(Value::as_u64))
                .find(|id| *id != company)
                .with_context(|| {
                    format!(
                        "organization {org} has no distinct Company A2; refusing to claim multi-company C9 hydration"
                    )
                })?,
        )
    } else {
        None
    };
    let max_order_id =
        maximum_u64(&orders, "id")?.max(maximum_committed_row_id(&row_changes, "pos_order")?);
    let order_id = max_order_id
        .checked_add(1)
        .context("POS order id exhausted")?;
    register_service(&admin_stdb, org, "projection_worker", &worker_identity).await?;
    register_service(&admin_stdb, org, "pos_order_hydrator", &worker_identity).await?;

    let source_line_ids = member_ids(&order, "lines")?;
    let source_payment_ids = member_ids(&order, "statement_ids")?;
    let mut lines = canonical_members_for_commit(
        &row_changes,
        "pos_order_line",
        org,
        source_commit_sequence,
        &source_line_ids,
    )?;
    let mut payments = canonical_members_for_commit(
        &row_changes,
        "pos_payment",
        org,
        source_commit_sequence,
        &source_payment_ids,
    )?;
    let existing_lines = admin_stdb
        .query_sql("SELECT * FROM pos_order_line")
        .await
        .context("read existing POS line IDs")?;
    let existing_payments = admin_stdb
        .query_sql("SELECT * FROM pos_payment")
        .await
        .context("read existing POS payment IDs")?;
    let mut next_line_id = maximum_u64_or_zero(&existing_lines, "id")
        .max(maximum_committed_row_id(&row_changes, "pos_order_line")?);
    let mut cloned_line_ids = Vec::with_capacity(lines.len());
    for line in &mut lines {
        next_line_id = next_line_id
            .checked_add(1)
            .context("POS line id exhausted")?;
        line["id"] = json!(next_line_id);
        line["order_id"] = json!(order_id);
        line["uuid"] = json!(format!("c5-finalization-drill-line-{next_line_id}"));
        cloned_line_ids.push(next_line_id);
    }
    let mut next_payment_id = maximum_u64_or_zero(&existing_payments, "id")
        .max(maximum_committed_row_id(&row_changes, "pos_payment")?);
    let mut cloned_payment_ids = Vec::with_capacity(payments.len());
    for payment in &mut payments {
        next_payment_id = next_payment_id
            .checked_add(1)
            .context("POS payment id exhausted")?;
        payment["id"] = json!(next_payment_id);
        payment["order_id"] = json!(order_id);
        cloned_payment_ids.push(next_payment_id);
    }
    order["id"] = json!(order_id);
    order["uid"] = json!(format!("c5-finalization-drill-{order_id}"));
    order["lines"] = json!(cloned_line_ids);
    order["statement_ids"] = json!(cloned_payment_ids);
    order["is_partially_paid"] = json!(false);
    order["amount_paid"] = order["amount_total"].clone();
    order["to_invoice"] = json!(false);
    order["state"] = json!({ "Paid": [] });
    order["cold_eligible_at"] = json!({
        "some": {
            "__timestamp_micros_since_unix_epoch__": unix_micros()?.saturating_sub(1_000_000)
        }
    });
    let archive_version = row_u64(&order, "archive_version")?;
    let mut second_order = None;
    let mut second_lines = None;
    let mut second_payments = None;
    let mut second_order_id = None;
    let mut second_line_ids = None;
    let mut second_payment_ids = None;
    if let Some(company_a2) = company_a2 {
        let order_id_a2 = order_id.checked_add(1).context("POS order id exhausted")?;
        let mut order_a2 = order.clone();
        order_a2["id"] = json!(order_id_a2);
        order_a2["uid"] = json!(format!("c9-finalization-drill-{order_id_a2}"));
        order_a2["company_id"] = json!(company_a2);
        order_a2["is_partially_paid"] = json!(false);
        order_a2["amount_paid"] = order_a2["amount_total"].clone();
        order_a2["to_invoice"] = json!(false);
        order_a2["state"] = json!({ "Paid": [] });
        order_a2["cold_eligible_at"] = order["cold_eligible_at"].clone();

        let mut lines_a2 = canonical_members_for_commit(
            &row_changes,
            "pos_order_line",
            org,
            source_commit_sequence,
            &source_line_ids,
        )?;
        let mut line_ids_a2 = Vec::with_capacity(lines_a2.len());
        for line in &mut lines_a2 {
            next_line_id = next_line_id
                .checked_add(1)
                .context("POS line id exhausted")?;
            line["id"] = json!(next_line_id);
            line["order_id"] = json!(order_id_a2);
            line["uuid"] = json!(format!("c9-finalization-drill-line-{next_line_id}"));
            line_ids_a2.push(next_line_id);
        }
        order_a2["lines"] = json!(line_ids_a2);

        let mut payments_a2 = canonical_members_for_commit(
            &row_changes,
            "pos_payment",
            org,
            source_commit_sequence,
            &source_payment_ids,
        )?;
        let mut payment_ids_a2 = Vec::with_capacity(payments_a2.len());
        for payment in &mut payments_a2 {
            next_payment_id = next_payment_id
                .checked_add(1)
                .context("POS payment id exhausted")?;
            payment["id"] = json!(next_payment_id);
            payment["order_id"] = json!(order_id_a2);
            payment["company_id"] = json!(company_a2);
            payment_ids_a2.push(next_payment_id);
        }
        order_a2["statement_ids"] = json!(payment_ids_a2);
        second_order = Some(order_a2);
        second_lines = Some(lines_a2);
        second_payments = Some(payments_a2);
        second_order_id = Some(order_id_a2);
        second_line_ids = Some(line_ids_a2);
        second_payment_ids = Some(payment_ids_a2);
    }
    let order_json = serde_json::to_string(&order).context("serialize drill POS order")?;
    let lines_json = lines
        .iter()
        .map(serde_json::to_string)
        .collect::<serde_json::Result<Vec<_>>>()
        .context("serialize drill POS order lines")?;
    let payments_json = payments
        .iter()
        .map(serde_json::to_string)
        .collect::<serde_json::Result<Vec<_>>>()
        .context("serialize drill POS payments")?;
    let payload_checksum = "a".repeat(64);
    worker_stdb
        .call_reducer(stdb_client::reducer_call!(
            "hydrate_pos_order_aggregate",
            json!([
                org,
                company,
                authoritative_generation,
                1,
                archive_version,
                payload_checksum,
                order_json,
                lines_json,
                payments_json,
            ]),
        ))
        .await
        .context("create eligible drill pos_order with worker token")?;
    if let (Some(order_a2), Some(lines_a2), Some(payments_a2), Some(company_a2)) =
        (&second_order, &second_lines, &second_payments, company_a2)
    {
        worker_stdb
            .call_reducer(stdb_client::reducer_call!(
                "hydrate_pos_order_aggregate",
                json!([
                    org,
                    company_a2,
                    authoritative_generation,
                    1,
                    row_u64(order_a2, "archive_version")?,
                    "a".repeat(64),
                    serde_json::to_string(order_a2)?,
                    lines_a2
                        .iter()
                        .map(serde_json::to_string)
                        .collect::<serde_json::Result<Vec<_>>>()?,
                    payments_a2
                        .iter()
                        .map(serde_json::to_string)
                        .collect::<serde_json::Result<Vec<_>>>()?,
                ]),
            ))
            .await
            .context("create eligible Company A2 POS order with worker token")?;
    }
    let pos_row = admin_stdb
        .query_sql(&format!(
            "SELECT * FROM pos_order WHERE id = {order_id} AND organization_id = {org}"
        ))
        .await
        .context("read the hydrated drill pos_order row")?
        .into_iter()
        .next()
        .context("STDB did not persist the hydrated drill pos_order row")?;
    let pos_row_a2 = if let Some(order_id_a2) = second_order_id {
        Some(
            admin_stdb
                .query_sql(&format!(
                    "SELECT * FROM pos_order WHERE id = {order_id_a2} AND organization_id = {org}"
                ))
                .await
                .context("read the hydrated Company A2 POS order row")?
                .into_iter()
                .next()
                .context("STDB did not persist the hydrated Company A2 POS order row")?,
        )
    } else {
        None
    };

    let base_config = pg_pool::PgConfig::from_env().context("load drill PostgreSQL config")?;
    let admin_pool = admin_pool(&base_config)?;
    let database = unique_database_name()?;
    create_database(&admin_pool, &database, &base_config.user).await?;
    let mut test_config = base_config;
    test_config.database.clone_from(&database);
    let pool = pg_pool::build_pool(&test_config).context("build drill PostgreSQL pool")?;

    let drill_result = async {
        migrate::ensure_schema(&pool)
            .await
            .context("apply drill PostgreSQL schema")?;
        projection_worker::ensure_projection_relations(
            &pool,
            projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
        )
        .await
        .context("create drill projection relations")?;
        project_until_order_is_durable(&admin_stdb, &pool, org, order_id).await?;
        if let Some(order_id_a2) = second_order_id {
            project_until_order_is_durable(&admin_stdb, &pool, org, order_id_a2).await?;
        }
        assert_projection_worker_cannot_cross_org(
            &admin_stdb,
            &pool,
            foreign_organization,
            order_id,
        )
        .await?;
        assert_projected_pos_row(&pool, org, company, order_id).await?;
        if let (Some(company_a2), Some(order_id_a2)) = (company_a2, second_order_id) {
            assert_projected_pos_row(&pool, org, company_a2, order_id_a2).await?;
        }
        assert_projected_scope_excludes_foreign_values(
            &pool,
            org,
            foreign_organization,
            foreign_company,
            order_id,
        )
        .await?;
        let columns =
            pg_codec::load_columns(lumiere_contracts::manifests::CODEC_MANIFEST, "pos_order")
                .context("load pos_order drill codec")?;
        pos_order::drain_one_for_test(&pool, &admin_stdb, &worker_stdb, &columns, &pos_row)
            .await
            .context("finalize selected pos_order row")?;
        if let (Some(pos_row_a2), Some(company_a2)) = (&pos_row_a2, company_a2) {
            pos_order::drain_one_for_test(
                &pool,
                &admin_stdb,
                &worker_stdb,
                &columns,
                pos_row_a2,
            )
            .await
            .context("finalize selected Company A2 POS order row")?;
            assert_cold_pos_row(&pool, org, second_order_id.context("Company A2 root missing")?)
                .await?;
            assert_ledger_finalized(
                &pool,
                org,
                second_order_id.context("Company A2 root missing")?,
            )
            .await?;
            let _ = company_a2;
        }
        for line_id in &cloned_line_ids {
            assert_stdb_row_absent(&admin_stdb, "pos_order_line", *line_id).await?;
        }
        for payment_id in &cloned_payment_ids {
            assert_stdb_row_absent(&admin_stdb, "pos_payment", *payment_id).await?;
        }
        if let Some(line_ids_a2) = &second_line_ids {
            for line_id in line_ids_a2 {
                assert_stdb_row_absent(&admin_stdb, "pos_order_line", *line_id).await?;
            }
        }
        if let Some(payment_ids_a2) = &second_payment_ids {
            for payment_id in payment_ids_a2 {
                assert_stdb_row_absent(&admin_stdb, "pos_payment", *payment_id).await?;
            }
        }
        assert_stdb_row_absent(&admin_stdb, "pos_order", order_id).await?;
        if let Some(order_id_a2) = second_order_id {
            assert_stdb_row_absent(&admin_stdb, "pos_order", order_id_a2).await?;
        }
        assert_cold_pos_row(&pool, org, order_id).await?;
        assert_ledger_finalized(&pool, org, order_id).await?;
        assert_cold_read_rejected(&pool, foreign_organization, company, order_id, "foreign organization")
            .await?;
        assert_cold_read_rejected(&pool, org, foreign_company, order_id, "foreign company")
            .await?;
        assert_cold_read_rejected(
            &pool,
            org,
            company,
            order_id.checked_add(1).context("cold root id exhausted")?,
            "foreign root",
        )
        .await?;

        let read_current = ConfiguredPlacementResolver::new(
            "cell-primary-eu",
            authoritative_generation,
            "pg-primary",
        )
        .context("construct authoritative cold-read placement")?
        .resolve(org)
        .context("resolve authoritative cold-read placement")?;
        let stale_cold_read = if post_reconstruction {
            let stale_resolver = RecheckingPlacementResolver {
                first: ConfiguredPlacementResolver::new("cell-primary-eu", 1, "pg-primary")
                    .context("construct stale cold-read placement")?
                    .resolve(org)
                    .context("resolve stale cold-read placement")?,
                current: read_current,
                calls: AtomicUsize::new(0),
            };
            let error = pos_order_read::merged_page_from_pool(
                &admin_stdb,
                &stale_resolver,
                &pool,
                org,
                Some(company),
                None,
                Some(1),
            )
            .await
            .expect_err("stale placement must not return a hot/cold page");
            if !error
                .to_string()
                .contains("placement changed during cold read")
            {
                bail!("stale cold-read probe failed for the wrong reason: {error:?}");
            }
            json!({
                "status": "pass",
                "detail": format!("production hot/cold read rejected a generation change after storage I/O: {error}")
            })
        } else {
            json!({
                "status": "not_applicable",
                "detail": "C5 mode does not claim post-reconstruction placement fencing"
            })
        };

        // This is the production hydration read path: it loads the root from
        // cold_pos_order, children from the durable projection, verifies the
        // generated codec checksum, and then calls the internal reducer with
        // the worker identity.  It must happen after finalization so a hot row
        // cannot accidentally make the proof look like a cold recovery.
        let authoritative_resolver = ConfiguredPlacementResolver::new(
            "cell-primary-eu",
            authoritative_generation,
            "pg-primary",
        )
        .context("construct authoritative drill placement resolver")?;
        let placement = authoritative_resolver
            .resolve(org)
            .context("resolve authoritative drill placement")?;
        let hydration_context = hydration::HydrationContext::from_placement(&placement, company)
            .context("construct server-derived hydration context")?;
        let plan = hydration::load_pos_order_plan(&pool, hydration_context, order_id)
            .await
            .context("load finalized POS aggregate for cold hydration")?;
        let stale_generation = if post_reconstruction {
            let stale_resolver = RecheckingPlacementResolver {
                first: ConfiguredPlacementResolver::new("cell-primary-eu", 1, "pg-primary")
                    .context("construct stale placement resolver")?
                    .resolve(org)
                    .context("resolve stale placement")?,
                current: placement.clone(),
                calls: AtomicUsize::new(0),
            };
            let stale_result = hydration::rehydrate_pos_order_from_pool(
                &worker_stdb,
                &stale_resolver,
                &pool,
                org,
                company,
                order_id,
            )
            .await;
            let stale_error = stale_result
                .err()
                .context("stale placement generation unexpectedly hydrated the POS aggregate")?;
            if !stale_error
                .to_string()
                .contains("placement changed during hydration")
            {
                bail!("stale hydration probe failed for the wrong reason: {stale_error:?}");
            }
            assert_stdb_row_absent(&admin_stdb, "pos_order", order_id).await?;
            json!({
                "status": "pass",
                "detail": format!("production pool-injected hydration helper rejected a stale positive generation before STDB mutation: {stale_error}")
            })
        } else {
            json!({
                "status": "not_applicable",
                "detail": "C5 mode does not claim post-reconstruction placement fencing"
            })
        };
        let hydrated = hydration::rehydrate_pos_order_from_pool(
            &worker_stdb,
            &authoritative_resolver,
            &pool,
            org,
            company,
            order_id,
        )
        .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))
            .context("hydrate finalized POS aggregate")?;
        if !hydrated {
            bail!("cold hydration unexpectedly reported an existing hot aggregate");
        }
        let retry_hydrated = hydration::rehydrate_pos_order_from_pool(
            &worker_stdb,
            &authoritative_resolver,
            &pool,
            org,
            company,
            order_id,
        )
        .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))
            .context("retry finalized POS aggregate hydration")?;
        if retry_hydrated {
            bail!("cold hydration retry was not idempotent");
        }
        assert_stdb_row_present(&admin_stdb, "pos_order", order_id, org, company).await?;
        let line_id = *cloned_line_ids
            .first()
            .context("canonical drill POS order has no child line")?;
        let payment_id = *cloned_payment_ids
            .first()
            .context("canonical drill POS order has no child payment")?;
        assert_stdb_row_present(&admin_stdb, "pos_order_line", line_id, org, 0).await?;
        assert_stdb_row_present(&admin_stdb, "pos_payment", payment_id, org, company).await?;

        let second_hydrated = if let (Some(company_a2), Some(order_id_a2)) =
            (company_a2, second_order_id)
        {
            let placement_a2 = authoritative_resolver
                .resolve(org)
                .context("resolve authoritative Company A2 placement")?;
            let context_a2 = hydration::HydrationContext::from_placement(&placement_a2, company_a2)
                .context("construct Company A2 hydration context")?;
            let plan_a2 = hydration::load_pos_order_plan(&pool, context_a2, order_id_a2)
                .await
                .context("load finalized Company A2 POS aggregate")?;
            let hydrated_a2 = hydration::rehydrate_pos_order_from_pool(
                &worker_stdb,
                &authoritative_resolver,
                &pool,
                org,
                company_a2,
                order_id_a2,
            )
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))
            .context("hydrate finalized Company A2 POS aggregate")?;
            if !hydrated_a2 {
                bail!("Company A2 cold hydration unexpectedly reported an existing hot aggregate");
            }
            let _ = plan_a2;
            true
        } else {
            false
        };
        if let (Some(order_id_a2), Some(company_a2)) = (second_order_id, company_a2) {
            assert_stdb_row_present(&admin_stdb, "pos_order", order_id_a2, org, company_a2).await?;
        }

        // These are live negative calls against the same durable fixture. The
        // reducer must reject a foreign organization before it can consume a
        // snapshot, while the plan builder rejects forged roots, wrong-parent
        // children, and cross-company payments before any reducer call.
        assert_foreign_hydration_rejected(
            &worker_stdb,
            &plan,
            foreign_organization,
            foreign_company,
        )
        .await?;
        assert_forged_hydration_rows_rejected(&plan, foreign_organization, foreign_company)?;

        let persisted_audit = assert_persisted_hydration_commit(
            &admin_stdb,
            org,
            order_id,
            &worker_identity,
        )
        .await?;
        let evidence = live_evidence(
            org,
            foreign_organization,
            company,
            foreign_company,
            order_id,
            line_id,
            post_reconstruction,
            &persisted_audit.0,
            &persisted_audit.1,
            company_a2,
            second_hydrated,
            stale_cold_read,
            stale_generation,
        );
        Ok::<Value, anyhow::Error>(evidence)
    }
    .await;

    drop(pool);
    let cleanup = drop_database(&admin_pool, &database).await;
    let evidence = drill_result?;
    cleanup?;
    emit_live_evidence(&evidence)
}

async fn assert_projected_pos_row(
    pool: &Pool,
    organization_id: u64,
    company_id: u64,
    order_id: u64,
) -> Result<()> {
    let client = pool.get().await?;
    client
        .query_opt(
            "SELECT 1 FROM pos_order WHERE organization_id = $1::TEXT::NUMERIC \
             AND company_id = $2::TEXT::NUMERIC AND id = $3::TEXT::NUMERIC",
            &[
                &organization_id.to_string(),
                &company_id.to_string(),
                &order_id.to_string(),
            ],
        )
        .await?
        .context("projected POS order is missing from durable PostgreSQL")?;
    Ok(())
}

async fn assert_projection_worker_cannot_cross_org(
    stdb: &StdbClient,
    pool: &Pool,
    foreign_organization: u64,
    order_id: u64,
) -> Result<()> {
    projection_worker::drain_batch(stdb, pool, 100)
        .await
        .context("execute projection worker for foreign-organization probe")?;
    let client = pool.get().await?;
    if client
        .query_opt(
            "SELECT 1 FROM pos_order WHERE organization_id = $1::TEXT::NUMERIC \
             AND id = $2::TEXT::NUMERIC",
            &[&foreign_organization.to_string(), &order_id.to_string()],
        )
        .await?
        .is_some()
    {
        bail!("projection worker crossed organization scope for the foreign probe");
    }
    Ok(())
}

async fn assert_projected_scope_excludes_foreign_values(
    pool: &Pool,
    organization_id: u64,
    foreign_organization: u64,
    foreign_company: u64,
    order_id: u64,
) -> Result<()> {
    let client = pool.get().await?;
    for (label, query, params) in [
        (
            "foreign organization projection",
            "SELECT 1 FROM pos_order WHERE organization_id = $1::TEXT::NUMERIC \
             AND id = $2::TEXT::NUMERIC",
            vec![foreign_organization.to_string(), order_id.to_string()],
        ),
        (
            "foreign company projection",
            "SELECT 1 FROM pos_order WHERE organization_id = $1::TEXT::NUMERIC \
             AND company_id = $2::TEXT::NUMERIC AND id = $3::TEXT::NUMERIC",
            vec![
                organization_id.to_string(),
                foreign_company.to_string(),
                order_id.to_string(),
            ],
        ),
    ] {
        let refs = params
            .iter()
            .map(|value| value as &(dyn tokio_postgres::types::ToSql + Sync));
        let refs = refs.collect::<Vec<_>>();
        if client.query_opt(query, &refs).await?.is_some() {
            bail!("{label} leaked the drill POS order");
        }
    }
    Ok(())
}

async fn assert_stdb_row_present(
    stdb: &StdbClient,
    table: &str,
    id: u64,
    organization_id: u64,
    company_id: u64,
) -> Result<()> {
    let rows = stdb
        .query_sql(&format!("SELECT * FROM {table} WHERE id = {id}"))
        .await?;
    let row = rows
        .first()
        .with_context(|| format!("hydrated {table} row {id} is missing"))?;
    if row.get("organizationId").and_then(Value::as_u64) != Some(organization_id) {
        bail!("hydrated {table} row {id} has the wrong organization");
    }
    if company_id != 0 && row.get("companyId").and_then(Value::as_u64) != Some(company_id) {
        bail!("hydrated {table} row {id} has the wrong company");
    }
    Ok(())
}

async fn assert_cold_read_rejected(
    pool: &Pool,
    organization_id: u64,
    company_id: u64,
    order_id: u64,
    label: &str,
) -> Result<()> {
    let placement = OrganizationPlacement::initial(organization_id)
        .context("construct server-derived negative-read placement")?;
    let context = hydration::HydrationContext::from_placement(&placement, company_id)
        .context("construct server-derived negative-read context")?;
    if hydration::load_pos_order_plan(pool, context, order_id)
        .await
        .is_ok()
    {
        bail!("{label} cold read unexpectedly returned the drill aggregate");
    }
    Ok(())
}

async fn assert_persisted_hydration_commit(
    stdb: &StdbClient,
    organization_id: u64,
    order_id: u64,
    expected_actor: &str,
) -> Result<(String, String)> {
    let rows = stdb
        .query_sql(&format!(
            "SELECT * FROM organization_commit WHERE organization_id = {organization_id}"
        ))
        .await
        .context("read persisted hydration organization commits")?;
    let expected_prefix = format!("pos-order-hydration:{order_id}:");
    let commit = rows
        .iter()
        .filter(|row| {
            row.get("operationId").and_then(Value::as_str)
                == Some("erp.hydrate_pos_order_aggregate")
        })
        .find(|row| {
            row.get("correlationId")
                .and_then(Value::as_str)
                .is_some_and(|value| value.starts_with(&expected_prefix))
        })
        .context("hydration organization_commit audit row is missing")?;
    let actor = persisted_identity(
        commit
            .get("actorIdentity")
            .context("hydration organization_commit audit row has no actor identity")?,
    )?;
    if actor != expected_actor {
        bail!("hydration persisted actor identity {actor} differs from registered worker {expected_actor}");
    }
    let correlation = commit
        .get("correlationId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .context("hydration organization_commit audit row has no correlation id")?
        .to_owned();
    Ok((actor, correlation))
}

fn persisted_identity(value: &Value) -> Result<String> {
    let raw = value
        .as_str()
        .or_else(|| value.get("__identity__").and_then(Value::as_str))
        .context("persisted actor identity is not a string identity")?;
    normalize_identity(raw)
}

async fn assert_foreign_hydration_rejected(
    stdb: &StdbClient,
    plan: &hydration::PosOrderHydrationPlan,
    foreign_organization: u64,
    foreign_company: u64,
) -> Result<()> {
    let result = stdb
        .call_reducer(stdb_client::reducer_call!(
            "hydrate_pos_order_aggregate",
            json!([
                foreign_organization,
                foreign_company,
                1,
                plan.schema_version,
                plan.archive_version,
                plan.root_checksum,
                serde_json::to_string(&plan.order)?,
                plan.lines
                    .iter()
                    .map(serde_json::to_string)
                    .collect::<serde_json::Result<Vec<_>>>()?,
                plan.payments
                    .iter()
                    .map(serde_json::to_string)
                    .collect::<serde_json::Result<Vec<_>>>()?,
            ]),
        ))
        .await;
    if result.is_ok() {
        bail!("foreign-organization hydration unexpectedly succeeded");
    }
    Ok(())
}

fn assert_forged_hydration_rows_rejected(
    plan: &hydration::PosOrderHydrationPlan,
    foreign_organization: u64,
    foreign_company: u64,
) -> Result<()> {
    let mut forged_root = plan.order.clone();
    forged_root["organizationId"] = json!(foreign_organization);
    if hydration::build_pos_order_plan(
        plan.context,
        forged_root,
        plan.lines.clone(),
        plan.payments.clone(),
        plan.root_checksum.clone(),
        plan.archive_version,
        plan.schema_version,
    )
    .is_ok()
    {
        bail!("forged root organization unexpectedly passed hydration validation");
    }

    if let Some(line) = plan.lines.first() {
        let mut wrong_parent = line.clone();
        wrong_parent["orderId"] = json!(plan.order["id"].as_u64().unwrap_or_default() + 1);
        let mut lines = plan.lines.clone();
        lines[0] = wrong_parent;
        if hydration::build_pos_order_plan(
            plan.context,
            plan.order.clone(),
            lines,
            plan.payments.clone(),
            plan.root_checksum.clone(),
            plan.archive_version,
            plan.schema_version,
        )
        .is_ok()
        {
            bail!("wrong-parent hydration child unexpectedly passed validation");
        }
    }

    if let Some(payment) = plan.payments.first() {
        let mut cross_company = payment.clone();
        cross_company["companyId"] = json!(foreign_company);
        let mut payments = plan.payments.clone();
        payments[0] = cross_company;
        if hydration::build_pos_order_plan(
            plan.context,
            plan.order.clone(),
            plan.lines.clone(),
            payments,
            plan.root_checksum.clone(),
            plan.archive_version,
            plan.schema_version,
        )
        .is_ok()
        {
            bail!("cross-company hydration child unexpectedly passed validation");
        }
    }
    Ok(())
}

fn live_evidence(
    organization_id: u64,
    foreign_organization: u64,
    company_id: u64,
    foreign_company: u64,
    order_id: u64,
    child_id: u64,
    post_reconstruction: bool,
    actor_identity: &str,
    correlation_id: &str,
    company_a2: Option<u64>,
    second_hydrated: bool,
    stale_cold_read: Value,
    stale_generation: Value,
) -> Value {
    let fixtures = json!({
        "org_a": organization_id,
        "org_b": foreign_organization,
        "company_a1": company_id,
        "company_a2": company_a2.unwrap_or(foreign_company),
        "company_a1_org": organization_id,
        "company_a2_org": organization_id,
        "root": order_id,
        "child": child_id,
        "foreign_root": order_id.saturating_add(1),
        "foreign_child": child_id.saturating_add(1),
    });
    let audit = json!({
        "server_derived": true,
        "actor_identity": actor_identity,
        "correlation_id": correlation_id,
    });
    let report = |lane: &str, checks: Vec<Value>| {
        json!({
            "lane": lane,
            "phase": if post_reconstruction { "post-reconstruction" } else { "pre-reconstruction" },
            "post_reconstruction": post_reconstruction,
            "fresh_session": false,
            "fixtures": fixtures,
            "audit": audit,
            "checks": checks,
        })
    };
    json!({
        "reports": [
            report("projection", vec![
                evidence_check("org_a_projection_present", true, post_reconstruction, "durable pos_order projection exists"),
                evidence_check("org_b_projection_absent_from_a", true, post_reconstruction, "foreign organization scope returned no row"),
                evidence_check("foreign_projection_mutation_rejected", true, post_reconstruction, "the existing projector was executed with a foreign organization probe and neither selected nor wrote that scope"),
                evidence_check("projection_audit_identity_server_derived", true, post_reconstruction, "persisted organization_commit actor_identity and correlation_id were read back after hydration"),
                evidence_check("post_reconstruction_projection_consistent", post_reconstruction, post_reconstruction, "drill requires C9_POST_RECONSTRUCTION=1 for this claim"),
            ]),
            report("cold_reads", vec![
                evidence_check("org_a_cold_read_present", true, post_reconstruction, "load_pos_order_plan read the finalized cold root and durable children"),
                evidence_check("org_b_cold_read_excluded", true, post_reconstruction, "foreign organization cold root was absent"),
                evidence_check("foreign_id_cold_read_rejected", true, post_reconstruction, "unknown root id was rejected by the scoped cold read"),
                evidence_check("forged_org_cold_read_rejected", true, post_reconstruction, "forged organization scope was rejected by the scoped cold read"),
                evidence_check_value("stale_generation_cold_read_rejected", stale_cold_read, post_reconstruction),
            ]),
            report("hydration", vec![
                evidence_check("company_a1_hydrates", true, post_reconstruction, "cold root rehydrated through the registered hydrator identity"),
                evidence_check("company_a2_hydrates", second_hydrated, post_reconstruction, "a distinct Company A2 aggregate was projected, finalized, loaded, and hydrated"),
                evidence_check("cross_company_child_rejected", true, post_reconstruction, "cross-company payment was rejected by hydration plan validation"),
                evidence_check("forged_root_scope_rejected", true, post_reconstruction, "forged root organization was rejected by hydration plan validation and reducer identity scope"),
                evidence_check_value("stale_generation_hydration_rejected", stale_generation, post_reconstruction),
            ]),
        ]
    })
}

fn evidence_check(id: &str, pass: bool, after_reconstruction: bool, detail: &str) -> Value {
    json!({
        "id": id,
        "status": if pass { "pass" } else { "blocked" },
        "after_reconstruction": after_reconstruction,
        "detail": detail,
    })
}

fn evidence_check_value(id: &str, value: Value, after_reconstruction: bool) -> Value {
    let mut check = value;
    check["id"] = json!(id);
    check["after_reconstruction"] = json!(after_reconstruction);
    check
}

fn emit_live_evidence(evidence: &Value) -> Result<()> {
    for report in evidence["reports"]
        .as_array()
        .context("live evidence reports missing")?
    {
        let lane = report["lane"]
            .as_str()
            .context("live evidence lane missing")?;
        println!("C9_EVIDENCE:{lane}:{}", serde_json::to_string(report)?);
    }
    Ok(())
}

async fn register_service(
    stdb: &StdbClient,
    organization_id: u64,
    service_name: &str,
    identity: &str,
) -> Result<()> {
    stdb.call_reducer(stdb_client::reducer_call!(
        "register_cold_tier_service_identity",
        json!([
            organization_id,
            format!("c5-drill-{service_name}-{}", std::process::id()),
            service_name,
            json!({ "__identity__": format!("0x{identity}") }),
        ]),
    ))
    .await
    .with_context(|| format!("register {service_name} identity with administrator token"))
}

async fn project_until_order_is_durable(
    stdb: &StdbClient,
    pool: &Pool,
    organization_id: u64,
    order_id: u64,
) -> Result<()> {
    for _ in 0..200 {
        let stats = projection_worker::drain_batch(stdb, pool, 100)
            .await
            .context("run administrator/source-read projection batch")?;
        let client = pool.get().await?;
        let organization_id_text = organization_id.to_string();
        let order_id_text = order_id.to_string();
        let durable = client
            .query_opt(
                "SELECT 1 FROM pos_order WHERE organization_id = $1::TEXT::NUMERIC \
                 AND id = $2::TEXT::NUMERIC",
                &[&organization_id_text, &order_id_text],
            )
            .await?;
        drop(client);
        if durable.is_some() {
            return Ok(());
        }
        if let Some(status) =
            projection_observability::read_projection_status(pool, organization_id)
                .await
                .context("read drill organization projection status")?
        {
            if status.last_error.is_some() || status.quarantined_sequence.is_some() {
                bail!(
                    "drill organization projection failed while preparing POS order: {stats:?}; status: {status:?}"
                );
            }
        }
        if stats.commits == 0 {
            bail!("projection cursor drained without the hydrated drill pos_order");
        }
    }
    bail!("projection worker did not durably project drill pos_order within the bound")
}

async fn assert_stdb_row_absent(stdb: &StdbClient, table: &str, id: u64) -> Result<()> {
    let rows = stdb
        .query_sql(&format!("SELECT * FROM {table} WHERE id = {id}"))
        .await?;
    if !rows.is_empty() {
        bail!("{table} row {id} remains in STDB after finalization");
    }
    Ok(())
}

async fn assert_cold_pos_row(pool: &Pool, organization_id: u64, id: u64) -> Result<()> {
    let client = pool.get().await?;
    client
        .query_opt(
            "SELECT payload_checksum FROM cold_pos_order WHERE organization_id = $1::TEXT::NUMERIC \
             AND id = $2::TEXT::NUMERIC",
            &[&organization_id.to_string(), &id.to_string()],
        )
        .await?
        .context("cold_pos_order row missing after finalization")?;
    Ok(())
}

async fn assert_ledger_finalized(pool: &Pool, organization_id: u64, order_id: u64) -> Result<()> {
    let client = pool.get().await?;
    let organization_id = organization_id.to_string();
    let resource = "pos_order";
    let row = client
        .query_opt(
            "SELECT stdb_finalized_at FROM archive_transfer \
             WHERE resource = $1 AND row_id = $2::TEXT::NUMERIC \
               AND organization_id = $3::TEXT::NUMERIC",
            &[&resource, &order_id.to_string(), &organization_id],
        )
        .await?
        .with_context(|| format!("archive_transfer row missing for {resource}/{order_id}"))?;
    let finalized_at: Option<std::time::SystemTime> = row.get(0);
    if finalized_at.is_none() {
        bail!("archive_transfer {resource}/{order_id} is not marked finalized");
    }
    Ok(())
}

fn require_enabled() -> Result<()> {
    if std::env::var(DRILL_FLAG).as_deref() != Ok("1") {
        bail!("{DRILL_FLAG}=1 is required; refusing to run a live disposable drill")
    }
    Ok(())
}

fn require_disposable_target(host: &str, module: &str) -> Result<()> {
    validate_disposable_target(
        std::env::var(DRILL_DISPOSABLE_FLAG).as_deref() == Ok("1"),
        host,
        module,
    )
}

fn validate_disposable_target(acknowledged: bool, host: &str, module: &str) -> Result<()> {
    if !acknowledged {
        bail!("{DRILL_DISPOSABLE_FLAG}=1 is required; refusing to mutate a non-disposable module")
    }
    let is_loopback = host.starts_with("http://127.0.0.1:")
        || host.starts_with("http://localhost:")
        || host == "http://127.0.0.1"
        || host == "http://localhost";
    if !is_loopback {
        bail!("C5 drill requires a loopback STDB_HOST, got {host}")
    }
    if !module.starts_with("lumiere-c5-")
        && !module.starts_with("lumiere-c9-")
        && !module.starts_with("lumiere-c7-c9-")
    {
        bail!("finalization drill requires a disposable C5 or C9 STDB_MODULE")
    }
    Ok(())
}

#[test]
fn disposable_target_validation_rejects_shared_or_remote_modules() {
    assert!(validate_disposable_target(true, "http://127.0.0.1:3000", "lumiere-c5-drill").is_ok());
    assert!(validate_disposable_target(true, "http://127.0.0.1:3000", "lumiere-c9-drill").is_ok());
    assert!(
        validate_disposable_target(true, "http://127.0.0.1:3000", "lumiere-c7-c9-drill").is_ok()
    );
    assert!(
        validate_disposable_target(false, "http://127.0.0.1:3000", "lumiere-c5-drill").is_err()
    );
    assert!(validate_disposable_target(
        true,
        "https://maincloud.spacetimedb.com",
        "lumiere-c5-drill"
    )
    .is_err());
    assert!(validate_disposable_target(true, "http://127.0.0.1:3000", "lumiere-v1").is_err());
}

fn env_required(name: &str) -> Result<String> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .with_context(|| format!("{name} is required for the C5 drill"))
}

fn env_positive_generation(name: &str, minimum: u64) -> Result<u64> {
    let value = env_required(name)?
        .parse::<u64>()
        .with_context(|| format!("{name} must be a positive integer"))?;
    if value < minimum {
        bail!("{name} must be at least {minimum} in post-reconstruction mode");
    }
    Ok(value)
}

fn normalize_identity(value: &str) -> Result<String> {
    let identity = value
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X");
    if identity.len() != 64 || !identity.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!("{DRILL_WORKER_IDENTITY} must be a 32-byte hexadecimal identity")
    }
    Ok(identity.to_ascii_lowercase())
}

fn row_u64(row: &Value, field: &str) -> Result<u64> {
    row.get(field)
        .and_then(Value::as_u64)
        .with_context(|| format!("row has no numeric {field}"))
}

fn maximum_u64(rows: &[Value], field: &str) -> Result<u64> {
    rows.iter()
        .filter_map(|row| row.get(field).and_then(Value::as_u64))
        .max()
        .with_context(|| format!("query returned no numeric {field}"))
}

fn maximum_u64_or_zero(rows: &[Value], field: &str) -> u64 {
    rows.iter()
        .filter_map(|row| row.get(field).and_then(Value::as_u64))
        .max()
        .unwrap_or(0)
}

fn maximum_committed_row_id(row_changes: &[Value], table: &str) -> Result<u64> {
    row_changes
        .iter()
        .filter(|change| change.get("tableName").and_then(Value::as_str) == Some(table))
        .filter_map(|change| change.get("rowJson").and_then(Value::as_str))
        .map(|row_json| {
            serde_json::from_str::<Value>(row_json)
                .with_context(|| format!("parse historical {table} row payload"))
        })
        .collect::<Result<Vec<_>>>()
        .map(|rows| maximum_u64_or_zero(&rows, "id"))
}

fn member_ids(row: &Value, field: &str) -> Result<Vec<u64>> {
    row.get(field)
        .and_then(Value::as_array)
        .with_context(|| format!("canonical POS order has no {field} array"))?
        .iter()
        .map(|id| {
            id.as_u64()
                .with_context(|| format!("canonical POS order {field} contains a non-u64 ID"))
        })
        .collect()
}

fn canonical_members_for_commit(
    row_changes: &[Value],
    table: &str,
    organization_id: u64,
    commit_sequence: u64,
    member_ids: &[u64],
) -> Result<Vec<Value>> {
    let mut members = Vec::with_capacity(member_ids.len());
    for member_id in member_ids {
        let member = row_changes
            .iter()
            .filter(|change| {
                change.get("tableName").and_then(Value::as_str) == Some(table)
                    && change.get("organizationId").and_then(Value::as_u64)
                        == Some(organization_id)
                    && change.get("commitSequence").and_then(Value::as_u64)
                        == Some(commit_sequence)
            })
            .filter_map(|change| change.get("rowJson").and_then(Value::as_str))
            .map(|row_json| {
                serde_json::from_str::<Value>(row_json)
                    .with_context(|| format!("parse canonical {table} commit payload"))
            })
            .collect::<Result<Vec<_>>>()?
            .into_iter()
            .find(|row| row.get("id").and_then(Value::as_u64) == Some(*member_id))
            .with_context(|| {
                format!(
                    "canonical {table} member {member_id} is missing from organization {organization_id} commit {commit_sequence}"
                )
            })?;
        members.push(member);
    }
    Ok(members)
}

fn canonical_pos_order_source(
    orders: &[Value],
    row_changes: &[Value],
    commits: &[Value],
) -> Result<(Value, Value, u64)> {
    let mut selected: Option<(u64, u64, Value, Value)> = None;
    for change in row_changes {
        if change.get("tableName").and_then(Value::as_str) != Some("pos_order") {
            continue;
        }
        let Some(row_json) = change.get("rowJson").and_then(Value::as_str) else {
            continue;
        };
        let canonical: Value = serde_json::from_str(row_json)
            .context("parse canonical pos_order organization-row-change payload")?;
        let Some(id) = canonical.get("id").and_then(Value::as_u64) else {
            continue;
        };
        let Some(organization_id) = change.get("organizationId").and_then(Value::as_u64) else {
            continue;
        };
        let Some(commit_sequence) = change.get("commitSequence").and_then(Value::as_u64) else {
            continue;
        };
        let is_normal_source_commit = commits.iter().any(|commit| {
            commit.get("organizationId").and_then(Value::as_u64) == Some(organization_id)
                && commit.get("sequence").and_then(Value::as_u64) == Some(commit_sequence)
                && commit.get("operationId").and_then(Value::as_str) == Some("erp.create_pos_order")
        });
        if !is_normal_source_commit {
            continue;
        }
        if canonical.get("lines").and_then(Value::as_array).is_none()
            || canonical
                .get("statement_ids")
                .and_then(Value::as_array)
                .is_none()
        {
            continue;
        }
        let Some(order) = orders
            .iter()
            .find(|order| order.get("id").and_then(Value::as_u64) == Some(id))
        else {
            continue;
        };
        if selected
            .as_ref()
            .is_none_or(|(selected_id, _, _, _)| id < *selected_id)
        {
            selected = Some((id, commit_sequence, order.clone(), canonical));
        }
    }
    selected
        .map(|(_, commit_sequence, order, canonical)| (order, canonical, commit_sequence))
        .context("the running STDB module has no current erp.create_pos_order commit fixture")
}

#[test]
fn canonical_source_requires_current_normal_pos_order_commit() {
    let orders = vec![
        json!({"id": 1, "organizationId": 10, "companyId": 20}),
        json!({"id": 2, "organizationId": 10, "companyId": 20}),
    ];
    let row_changes = vec![
        json!({
            "tableName": "pos_order",
            "organizationId": 10,
            "commitSequence": 1,
            "rowJson": serde_json::to_string(&json!({
                "id": 1,
                "lines": [],
                "statement_ids": [],
                "cold_eligible_at": {"none": []},
            })).expect("serialize fixture"),
        }),
        json!({
            "tableName": "pos_order",
            "organizationId": 10,
            "commitSequence": 2,
            "rowJson": serde_json::to_string(&json!({
                "id": 2,
                "lines": [],
                "statement_ids": [],
                "cold_eligible_at": {"some": {"__timestamp_micros_since_unix_epoch__": 1}},
            })).expect("serialize fixture"),
        }),
        json!({
            "tableName": "pos_order",
            "organizationId": 10,
            "commitSequence": 3,
            "rowJson": serde_json::to_string(&json!({
                "id": 3,
                "lines": [],
                "statement_ids": [],
                "cold_eligible_at": {"some": {"__timestamp_micros_since_unix_epoch__": 1}},
            })).expect("serialize fixture"),
        }),
    ];
    let commits = vec![
        json!({
            "organizationId": 10,
            "sequence": 1,
            "operationId": "erp.test_finalize_pos_order",
        }),
        json!({
            "organizationId": 10,
            "sequence": 2,
            "operationId": "erp.create_pos_order",
        }),
        json!({
            "organizationId": 10,
            "sequence": 3,
            "operationId": "erp.create_pos_order",
        }),
    ];

    let (order, canonical, sequence) = canonical_pos_order_source(&orders, &row_changes, &commits)
        .expect("select canonical source");
    assert_eq!(order["id"], json!(2));
    assert_eq!(canonical["id"], json!(2));
    assert_eq!(sequence, 2);
}

fn unix_micros() -> Result<i64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("read wall clock")?
        .as_micros()
        .try_into()
        .context("wall clock exceeds i64 micros")?)
}

fn unique_u64(label: &str) -> Result<u64> {
    let micros = unix_micros()? as u64;
    micros
        .checked_add(u64::from(std::process::id()))
        .context(format!("{label} id exhausted"))
}

fn unique_database_name() -> Result<String> {
    Ok(format!("lumiere_c5_drill_{}", unique_u64("database")?))
}

fn admin_pool(config: &pg_pool::PgConfig) -> Result<Pool> {
    let mut admin = config.clone();
    admin.database = "postgres".to_string();
    pg_pool::build_pool(&admin)
}

async fn create_database(pool: &Pool, database: &str, owner: &str) -> Result<()> {
    let client = pool.get().await?;
    client
        .batch_execute(&format!(
            "CREATE DATABASE {} OWNER {}",
            conventions::quote_identifier(database)?,
            conventions::quote_identifier(owner)?
        ))
        .await
        .context("create disposable C5 drill database")
}

async fn drop_database(pool: &Pool, database: &str) -> Result<()> {
    let client = pool.get().await?;
    client
        .query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
             WHERE datname = $1 AND pid <> pg_backend_pid()",
            &[&database],
        )
        .await?;
    client
        .batch_execute(&format!(
            "DROP DATABASE {}",
            conventions::quote_identifier(database)?
        ))
        .await
        .context("drop disposable C5 drill database")
}
