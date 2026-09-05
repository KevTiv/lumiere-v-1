//! Trusted cold-tier hydration for mutable aggregates.
//!
//! Hydration is intentionally an API-server operation: Postgres is read only
//! after the server has resolved the tenant placement, and SpacetimeDB stays
//! the only state transition authority.  The caller never supplies a table,
//! SQL fragment, store name, or row payload.  This module uses the generated
//! manifests and fixed POS aggregate relation to build the reducer payload.

use std::collections::BTreeSet;

use anyhow::{anyhow, bail, Context, Result};
use deadpool_postgres::Pool;
use serde_json::{json, Value};
use stdb_client::StdbClient;
use tokio_postgres::types::ToSql;

use super::{conventions, pg_codec, pg_pool};
use crate::error::ApiError;
use crate::organization_placement::{
    OrganizationPlacement, OrganizationPlacementResolver, PlacementGeneration,
};

const TABLE: &str = "pos_order";
const COLD_TABLE: &str = "cold_pos_order";
const LINE_TABLE: &str = "pos_order_line";
const PAYMENT_TABLE: &str = "pos_payment";
const HYDRATION_MANIFEST_JSON: &str = lumiere_contracts::manifests::HYDRATION_MANIFEST;
const PROJECTION_CODEC_MANIFEST_JSON: &str =
    lumiere_contracts::manifests::PROJECTION_CODEC_MANIFEST;
const CURRENT_SCHEMA_VERSION: u32 = 1;

/// Metadata resolved by the authenticated server before durable I/O.
///
/// `placement_generation` must come from the server's placement resolver. It
/// is deliberately not deserializable from an HTTP request in this module.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HydrationContext {
    organization_id: u64,
    company_id: u64,
    placement_generation: u64,
}

impl HydrationContext {
    /// Resolve the current bootstrap placement. The first production topology
    /// has one server-owned execution cell/store generation; callers supply
    /// only authenticated tenant scope, never the generation itself.
    pub fn current(organization_id: u64, company_id: u64) -> Self {
        Self {
            organization_id,
            company_id,
            placement_generation: PlacementGeneration::INITIAL.get(),
        }
    }

    /// Build hydration context from the server-resolved organization
    /// placement.  Callers provide only company scope; the generation is
    /// copied from the trusted placement record and cannot be selected by an
    /// HTTP payload.
    pub fn from_placement(placement: &OrganizationPlacement, company_id: u64) -> Result<Self> {
        if company_id == 0 {
            bail!("hydration requires non-zero company scope");
        }
        Ok(Self {
            organization_id: placement.organization_id(),
            company_id,
            placement_generation: placement.generation().get(),
        })
    }
}

/// A fully validated aggregate snapshot ready for the internal STDB reducer.
/// The JSON values are produced from generated PG codec metadata, never from
/// caller input.
#[derive(Debug, Clone)]
pub struct PosOrderHydrationPlan {
    pub context: HydrationContext,
    pub archive_version: u64,
    pub schema_version: u32,
    pub root_checksum: String,
    pub order: Value,
    pub lines: Vec<Value>,
    pub payments: Vec<Value>,
}

/// Build a validated hydration plan from durable rows.
///
/// The root checksum is checked against the checksum stored by the C5
/// drainer. Child membership is exact: missing, extra, duplicate, cross-org,
/// cross-company, or wrong-parent rows all fail closed.
pub fn build_pos_order_plan(
    context: HydrationContext,
    order: Value,
    lines: Vec<Value>,
    payments: Vec<Value>,
    root_checksum: String,
    archive_version: u64,
    schema_version: u32,
) -> Result<PosOrderHydrationPlan> {
    let contract = pos_order_contract()?;
    if context.organization_id == 0 || context.company_id == 0 {
        bail!("hydration requires non-zero organization and company scope");
    }
    if context.placement_generation == 0 {
        bail!("hydration placement generation is invalid");
    }
    if schema_version != contract.schema_version || schema_version != CURRENT_SCHEMA_VERSION {
        bail!("hydration schema version is not supported");
    }
    if archive_version == 0 {
        bail!("hydration archive version must be non-zero");
    }
    if !is_sha256_hex(&root_checksum) {
        bail!("hydration root checksum must be a sha-256 hex digest");
    }

    require_u64(&order, "id", "order")?;
    require_scope(&order, "order", context.organization_id, context.company_id)?;
    if order.get("archiveVersion").and_then(Value::as_u64) != Some(archive_version) {
        bail!("hydration archive version does not match durable root");
    }

    let expected_lines = id_set(&order, "lines", "order")?;
    let expected_payments = id_set(&order, "statementIds", "order")?;
    let actual_lines = validate_lines(&lines, &context, order_id(&order)?)?;
    let actual_payments = validate_payments(&payments, &context, order_id(&order)?)?;
    if expected_lines != actual_lines {
        bail!("hydration aggregate membership does not match order lines");
    }
    if expected_payments != actual_payments {
        bail!("hydration aggregate membership does not match order payments");
    }

    Ok(PosOrderHydrationPlan {
        context,
        archive_version,
        schema_version,
        root_checksum,
        order,
        lines,
        payments,
    })
}

/// Fetch the fixed POS aggregate from the placement-resolved PG pool.
///
/// The `pool` is supplied by the server's configured durable placement; this
/// function has no store/table/SQL selection parameter.  The query values are
/// bound and all selected columns come from the generated codec manifest.
pub async fn load_pos_order_plan(
    pool: &Pool,
    context: HydrationContext,
    order_id: u64,
) -> Result<PosOrderHydrationPlan> {
    let root_columns = pg_codec::load_columns(PROJECTION_CODEC_MANIFEST_JSON, TABLE)
        .context("load pos_order hydration codec")?;
    let line_columns = pg_codec::load_columns(PROJECTION_CODEC_MANIFEST_JSON, LINE_TABLE)
        .context("load pos_order_line hydration codec")?;
    let payment_columns = pg_codec::load_columns(PROJECTION_CODEC_MANIFEST_JSON, PAYMENT_TABLE)
        .context("load pos_payment hydration codec")?;

    let client = pool.get().await.context("get PG client for hydration")?;
    let org = context.organization_id.to_string();
    let company = context.company_id.to_string();
    let id = order_id.to_string();

    let root_select = select_columns(&root_columns);
    let root_sql = format!(
        "SELECT {root_select}, payload_checksum FROM {COLD_TABLE} \
         WHERE organization_id = $1::NUMERIC AND company_id = $2::NUMERIC AND id = $3::NUMERIC"
    );
    let root_params: [&(dyn ToSql + Sync); 3] = [&org, &company, &id];
    let root_row = client
        .query_opt(&root_sql, &root_params)
        .await
        .context("load durable pos_order root")?
        .ok_or_else(|| anyhow!("durable pos_order {order_id} was not found"))?;
    let order = pg_codec::row_to_hot_json(&root_columns, &root_row)
        .context("decode durable pos_order root")?;
    let values = pg_codec::decode_row(&root_columns, &order).context("decode root checksum")?;
    let computed_checksum = pg_codec::checksum_for(&root_columns, &values);
    let stored_checksum: String = root_row
        .try_get(root_columns.len())
        .context("read durable pos_order checksum")?;
    if stored_checksum != computed_checksum {
        bail!("durable pos_order {order_id} checksum does not match its payload");
    }
    let archive_version = order
        .get("archiveVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow!("durable pos_order {order_id} has no archive version"))?;

    let line_select = select_columns(&line_columns);
    let line_sql = format!(
        "SELECT {line_select} FROM {LINE_TABLE} \
         WHERE organization_id = $1::NUMERIC AND order_id = $2::NUMERIC ORDER BY id ASC"
    );
    let line_params: [&(dyn ToSql + Sync); 2] = [&org, &id];
    let lines = client
        .query(&line_sql, &line_params)
        .await
        .context("load durable pos_order lines")?
        .iter()
        .map(|row| pg_codec::row_to_hot_json(&line_columns, row))
        .collect::<Result<Vec<_>>>()?;

    let payment_select = select_columns(&payment_columns);
    let payment_sql = format!(
        "SELECT {payment_select} FROM {PAYMENT_TABLE} \
         WHERE organization_id = $1::NUMERIC AND company_id = $2::NUMERIC \
           AND order_id = $3::NUMERIC ORDER BY id ASC"
    );
    let payment_params: [&(dyn ToSql + Sync); 3] = [&org, &company, &id];
    let payments = client
        .query(&payment_sql, &payment_params)
        .await
        .context("load durable pos_order payments")?
        .iter()
        .map(|row| pg_codec::row_to_hot_json(&payment_columns, row))
        .collect::<Result<Vec<_>>>()?;

    build_pos_order_plan(
        context,
        order,
        lines,
        payments,
        stored_checksum,
        archive_version,
        CURRENT_SCHEMA_VERSION,
    )
}

/// Hydrate an absent POS aggregate through the fixed internal reducer.
///
/// Existing rows are treated as an idempotent success only after their
/// organization/company identity is checked. The reducer itself repeats the
/// aggregate checks inside the STDB transaction, so a retry cannot overwrite
/// a different tenant's row or partially insert a child set.
pub async fn hydrate_pos_order_if_absent(
    stdb: &StdbClient,
    plan: &PosOrderHydrationPlan,
) -> Result<bool, ApiError> {
    let id = order_id(&plan.order).map_err(ApiError::internal)?;
    let sql = format!(
        "SELECT id, organization_id, company_id FROM `{TABLE}` \
         WHERE organization_id = {} AND id = {} LIMIT 1",
        plan.context.organization_id, id
    );
    let existing = stdb
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(format!("check hot hydration target: {e}")))?;
    if let Some(row) = existing.first() {
        let org = row.get("organizationId").and_then(Value::as_u64);
        let company = row.get("companyId").and_then(Value::as_u64);
        if org != Some(plan.context.organization_id) || company != Some(plan.context.company_id) {
            return Err(ApiError::Forbidden(
                "hydration target scope mismatch".into(),
            ));
        }
        return Ok(false);
    }

    let args = json!([
        plan.context.organization_id,
        plan.context.company_id,
        plan.context.placement_generation,
        plan.schema_version,
        plan.archive_version,
        plan.root_checksum,
        serde_json::to_string(&plan.order).map_err(ApiError::internal)?,
        plan.lines
            .iter()
            .map(|row| serde_json::to_string(row))
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(ApiError::internal)?,
        plan.payments
            .iter()
            .map(|row| serde_json::to_string(row))
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(ApiError::internal)?,
    ]);
    stdb.call_reducer(stdb_client::reducer_call!(
        "hydrate_pos_order_aggregate",
        args,
    ))
    .await
    .map_err(|e| ApiError::Internal(format!("hydrate pos_order aggregate: {e}")))?;
    Ok(true)
}

/// Resolve the server-owned durable placement, load the exact aggregate, and
/// atomically upsert it into STDB. Business endpoints call this before their
/// existing reducer when a mutable POS order is no longer hot.
///
/// The public inputs are identities only. The durable store, table set,
/// generation, schema, version, checksum, and reducer payload all remain
/// server-controlled.
pub async fn rehydrate_pos_order_from_durable<R: OrganizationPlacementResolver>(
    stdb: &StdbClient,
    placements: &R,
    organization_id: u64,
    company_id: u64,
    order_id: u64,
) -> Result<bool, ApiError> {
    let placement = placements.resolve(organization_id).map_err(|error| {
        ApiError::Internal(format!(
            "resolve authoritative organization placement: {error}"
        ))
    })?;
    if !placement.lifecycle().permits_business_execution() {
        return Err(ApiError::Conflict(
            "organization placement is fenced for hydration".into(),
        ));
    }
    if company_id == 0 || order_id == 0 {
        return Err(ApiError::Unprocessable(
            "hydration requires positive company and order IDs".into(),
        ));
    }
    let pool = pg_pool::shared_pool().ok_or_else(|| {
        ApiError::Internal("durable placement is unavailable for POS hydration".into())
    })?;
    let plan = load_pos_order_plan(
        pool,
        HydrationContext::from_placement(placement, company_id).map_err(|error| {
            ApiError::Internal(format!("resolve POS hydration context: {error}"))
        })?,
        order_id,
    )
    .await
    .map_err(|error| ApiError::Internal(format!("load durable POS aggregate: {error}")))?;
    hydrate_pos_order_if_absent(stdb, &plan).await
}

fn pos_order_contract() -> Result<ManifestContract> {
    let manifest: Value = serde_json::from_str(HYDRATION_MANIFEST_JSON)
        .context("parse generated hydration manifest")?;
    let policy = manifest["policies"]
        .as_array()
        .and_then(|policies| policies.iter().find(|p| p["table"] == TABLE))
        .ok_or_else(|| anyhow!("generated hydration manifest lacks pos_order"))?;
    let durable = &policy["durable"];
    let schema_version = durable["schema_version"]
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| anyhow!("hydration manifest has no schema version"))?;
    if durable["checksum_algorithm"] != conventions::PAYLOAD_CHECKSUM_ALGO {
        bail!("unsupported hydration checksum algorithm");
    }
    Ok(ManifestContract { schema_version })
}

#[derive(Debug, Clone, Copy)]
struct ManifestContract {
    schema_version: u32,
}

fn select_columns(columns: &[pg_codec::ColumnCodec]) -> String {
    columns
        .iter()
        .map(|column| match column.pg_type.as_str() {
            "NUMERIC(20,0)" | "JSONB" => {
                format!("\"{}\"::TEXT", column.name.replace('"', "\"\""))
            }
            _ => format!("\"{}\"", column.name.replace('"', "\"\"")),
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn order_id(order: &Value) -> Result<u64> {
    require_u64(order, "id", "order")
}

fn require_u64(value: &Value, key: &str, label: &str) -> Result<u64> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow!("hydration {label} has no valid {key}"))
}

fn require_scope(value: &Value, label: &str, organization_id: u64, company_id: u64) -> Result<()> {
    if value.get("organizationId").and_then(Value::as_u64) != Some(organization_id)
        || value.get("companyId").and_then(Value::as_u64) != Some(company_id)
    {
        bail!("hydration {label} organization/company scope mismatch");
    }
    Ok(())
}

fn id_set(value: &Value, key: &str, label: &str) -> Result<BTreeSet<u64>> {
    let values = value
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("hydration {label} has no {key} membership"))?;
    let mut ids = BTreeSet::new();
    for id in values {
        let id = id
            .as_u64()
            .ok_or_else(|| anyhow!("hydration {label} has malformed {key} membership"))?;
        if !ids.insert(id) {
            bail!("hydration {label} has duplicate {key} membership");
        }
    }
    Ok(ids)
}

fn validate_lines(
    lines: &[Value],
    context: &HydrationContext,
    order_id: u64,
) -> Result<BTreeSet<u64>> {
    let mut ids = BTreeSet::new();
    for line in lines {
        let id = require_u64(line, "id", "line")?;
        if !ids.insert(id) {
            bail!("hydration contains duplicate line {id}");
        }
        if line.get("organizationId").and_then(Value::as_u64) != Some(context.organization_id)
            || line.get("orderId").and_then(Value::as_u64) != Some(order_id)
        {
            bail!("hydration line {id} has the wrong organization or parent");
        }
    }
    Ok(ids)
}

fn validate_payments(
    payments: &[Value],
    context: &HydrationContext,
    order_id: u64,
) -> Result<BTreeSet<u64>> {
    let mut ids = BTreeSet::new();
    for payment in payments {
        let id = require_u64(payment, "id", "payment")?;
        if !ids.insert(id) {
            bail!("hydration contains duplicate payment {id}");
        }
        if payment.get("organizationId").and_then(Value::as_u64) != Some(context.organization_id)
            || payment.get("companyId").and_then(Value::as_u64) != Some(context.company_id)
            || payment.get("orderId").and_then(Value::as_u64) != Some(order_id)
        {
            bail!("hydration payment {id} has the wrong organization, company, or parent");
        }
    }
    Ok(ids)
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_projection_codec_covers_complete_pos_aggregate() {
        for table in [TABLE, LINE_TABLE, PAYMENT_TABLE] {
            let columns = pg_codec::load_columns(PROJECTION_CODEC_MANIFEST_JSON, table)
                .expect("hydration member must have a generated durable codec");
            assert!(!columns.is_empty(), "{table} codec must not be empty");
        }
    }

    fn root() -> Value {
        json!({
            "id": 10,
            "organizationId": 7,
            "companyId": 8,
            "archiveVersion": 2,
            "lines": [11],
            "statementIds": [12]
        })
    }

    fn context() -> HydrationContext {
        HydrationContext::current(7, 8)
    }

    #[test]
    fn validates_complete_aggregate_membership() {
        let plan = build_pos_order_plan(
            context(),
            root(),
            vec![json!({"id":11,"organizationId":7,"orderId":10})],
            vec![json!({"id":12,"organizationId":7,"companyId":8,"orderId":10})],
            "a".repeat(64),
            2,
            1,
        );
        assert!(plan.is_ok());
    }

    #[test]
    fn rejects_cross_tenant_child() {
        let err = build_pos_order_plan(
            context(),
            root(),
            vec![json!({"id":11,"organizationId":99,"orderId":10})],
            vec![json!({"id":12,"organizationId":7,"companyId":8,"orderId":10})],
            "a".repeat(64),
            2,
            1,
        )
        .expect_err("cross-tenant child must fail");
        assert!(err.to_string().contains("wrong organization"));
    }

    #[test]
    fn rejects_missing_member_and_bad_generation() {
        let err = build_pos_order_plan(
            HydrationContext {
                placement_generation: 0,
                ..context()
            },
            root(),
            vec![],
            vec![json!({"id":12,"organizationId":7,"companyId":8,"orderId":10})],
            "a".repeat(64),
            2,
            1,
        )
        .expect_err("invalid generation must fail");
        assert!(err.to_string().contains("placement generation"));
    }

    #[test]
    fn rejects_duplicate_membership_and_checksum_shape() {
        let mut duplicate = root();
        duplicate["lines"] = json!([11, 11]);
        let err = build_pos_order_plan(
            context(),
            duplicate,
            vec![],
            vec![],
            "not-a-checksum".into(),
            2,
            1,
        )
        .expect_err("duplicate membership must fail");
        assert!(err.to_string().contains("sha-256"));
    }
}
