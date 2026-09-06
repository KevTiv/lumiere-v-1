//! SpacetimeDB reconstruction sink.

use super::super::{pg_codec, reconciliation};
use super::catalog::RestoreTable;
use super::integrity::{
    canonical_json, digest_rows, quote_identifier, require_server_identity, validate_run_id,
};
use super::protocol::{
    ApplyDisposition, DurableWatermark, ReconstructionFence, ReconstructionSink, RestoreRow,
    TableDigest,
};
use super::MAX_DIGEST_ROWS;
use anyhow::{bail, Context, Result};
use deadpool_postgres::Pool;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use stdb_client::{ReducerCall, StdbClient};

/// Trusted STDB reconstruction adapter. It owns the server identity and the
/// run identity used by every reducer call.
pub struct StdbReconstructionSink<'a> {
    stdb: &'a StdbClient,
    read_stdb: &'a StdbClient,
    pool: &'a Pool,
    run_id: String,
    placement_generation: u64,
    inject_failure_after_batch: bool,
    fence_acquired: AtomicBool,
}

impl<'a> StdbReconstructionSink<'a> {
    pub fn new(
        stdb: &'a StdbClient,
        read_stdb: &'a StdbClient,
        pool: &'a Pool,
        run_id: impl Into<String>,
        placement_generation: u64,
    ) -> Result<Self> {
        require_server_identity(stdb)?;
        require_server_identity(read_stdb)?;
        if stdb.token() == read_stdb.token() {
            bail!("reconstruction reducer and verification identities must be distinct");
        }
        let run_id = run_id.into();
        validate_run_id(&run_id)?;
        if placement_generation == 0 {
            bail!("reconstruction placement generation must be non-zero");
        }
        let inject_failure_after_batch = failure_injection_enabled(
            std::env::var("C7_INJECT_FAILURE_AFTER_BATCH")
                .ok()
                .as_deref(),
            stdb.base_url(),
            std::env::var("C7_DISPOSABLE_STDB").ok().as_deref(),
        )?;
        Ok(Self {
            stdb,
            read_stdb,
            pool,
            run_id,
            placement_generation,
            inject_failure_after_batch,
            fence_acquired: AtomicBool::new(false),
        })
    }

    #[must_use]
    pub fn has_acquired_fence(&self) -> bool {
        self.fence_acquired.load(Ordering::Acquire)
    }

    pub async fn mark_failed(&self, organization_id: u64, error: &anyhow::Error) -> Result<()> {
        let mut failure = format!("{error:#}");
        if failure.len() > 1024 {
            let mut end = 1024;
            while !failure.is_char_boundary(end) {
                end -= 1;
            }
            failure.truncate(end);
        }
        self.call(
            "fail_organization_reconstruction",
            json!([organization_id, self.run_id, failure]),
        )
        .await
    }

    async fn call(&self, reducer: &str, args: Value) -> Result<()> {
        self.stdb
            .call_reducer(ReducerCall::from_name(reducer, args))
            .await
            .with_context(|| format!("call trusted reconstruction reducer '{reducer}'"))
    }
}

impl ReconstructionSink for StdbReconstructionSink<'_> {
    async fn acquire_fence(
        &self,
        organization_id: u64,
        watermark: &DurableWatermark,
    ) -> Result<ReconstructionFence> {
        self.call(
            "begin_organization_reconstruction",
            json!([
                organization_id,
                self.run_id,
                self.placement_generation,
                watermark.sequence,
                watermark.commit_checksum
            ]),
        )
        .await?;
        self.fence_acquired.store(true, Ordering::Release);
        Ok(ReconstructionFence {
            token: self.run_id.clone(),
            organization_id,
            placement_generation: self.placement_generation,
            watermark: watermark.clone(),
        })
    }

    async fn apply_batch(
        &self,
        fence: &ReconstructionFence,
        table: &RestoreTable,
        batch_ordinal: u64,
        is_last_batch: bool,
        rows: &[RestoreRow],
    ) -> Result<ApplyDisposition> {
        let columns = pg_codec::load_columns(
            lumiere_contracts::manifests::PROJECTION_CODEC_MANIFEST,
            &table.table,
        )?;
        let rows_json = rows
            .iter()
            .map(|row| canonical_stdb_row_json(&columns, &row.row))
            .collect::<Result<Vec<_>>>()?;
        self.call(
            "apply_organization_reconstruction_batch",
            json!([
                fence.organization_id,
                fence.token,
                table.table,
                table.restore_order,
                batch_ordinal,
                is_last_batch,
                rows_json
            ]),
        )
        .await?;
        if self.inject_failure_after_batch && batch_ordinal == 0 && !rows.is_empty() {
            bail!("C7 injected failure after a committed reconstruction batch");
        }
        Ok(ApplyDisposition::Applied)
    }

    async fn table_digest(
        &self,
        fence: &ReconstructionFence,
        table: &RestoreTable,
    ) -> Result<TableDigest> {
        let columns = pg_codec::load_columns(
            lumiere_contracts::manifests::PROJECTION_CODEC_MANIFEST,
            &table.table,
        )?;
        let projection = columns
            .iter()
            .map(|column| quote_identifier(stdb_sql_field_name(&column.name)))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT {projection} FROM {} WHERE {} = {} LIMIT {}",
            quote_identifier(&table.table),
            quote_identifier(&table.organization_column),
            fence.organization_id,
            MAX_DIGEST_ROWS + 1,
        );
        let rows = self.read_stdb.query_sql_sats(&sql).await.with_context(|| {
            format!("read STDB reconstruction digest relation '{}'", table.table)
        })?;
        if rows.len() > MAX_DIGEST_ROWS {
            bail!("STDB reconstruction digest exceeds bounded row limit");
        }
        let rows = rows
            .into_iter()
            .map(|row| normalize_stdb_digest_row(&columns, row))
            .collect::<Result<Vec<_>>>()?;
        digest_rows(&rows)
    }

    async fn prepare_recreated_state(
        &self,
        _fence: &ReconstructionFence,
        tables: &[String],
    ) -> Result<()> {
        const EXPECTED_RECREATED: [&str; 5] = [
            "cold_tier_service_identity",
            "organization_reconstruction_batch_receipt",
            "organization_reconstruction_fence",
            "policy_snapshot",
            "project_margin_snapshot",
        ];
        if tables.iter().map(String::as_str).collect::<Vec<_>>() != EXPECTED_RECREATED {
            bail!("generated recreated-state contract does not match the trusted rebuild set");
        }
        Ok(())
    }

    async fn verify_before_release(&self, fence: &ReconstructionFence) -> Result<()> {
        let report = reconciliation::reconcile_organization(
            self.read_stdb,
            self.pool,
            fence.organization_id,
            fence.watermark.sequence,
        )
        .await
        .context("reconcile reconstructed organization before releasing fence")?;
        if !report.matches() {
            let mismatches = report
                .mismatches()
                .into_iter()
                .map(|table| table.table.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            bail!("reconstruction reconciliation mismatch: {mismatches}");
        }
        Ok(())
    }

    async fn release_fence(&self, fence: &ReconstructionFence) -> Result<()> {
        self.call(
            "complete_organization_reconstruction",
            json!([
                fence.organization_id,
                fence.token,
                self.placement_generation,
                fence.watermark.sequence,
                fence.watermark.commit_checksum
            ]),
        )
        .await
    }
}

fn canonical_stdb_row_json(columns: &[pg_codec::ColumnCodec], row: &Value) -> Result<String> {
    let source = row
        .as_object()
        .context("reconstruction row payload must be an object")?;
    if source.len() != columns.len() {
        bail!("reconstruction row payload does not match generated columns");
    }
    let mut stdb_row = serde_json::Map::new();
    for column in columns {
        let api_key = pg_codec::snake_to_camel(&column.name);
        let value = source
            .get(&api_key)
            .with_context(|| format!("reconstruction row lacks generated column '{api_key}'"))?;
        stdb_row.insert(
            rust_field_name(&column.name).to_owned(),
            durable_value_to_sats(column, value)?,
        );
    }
    canonical_json(&Value::Object(stdb_row))
}

fn rust_field_name(column_name: &str) -> &str {
    match column_name {
        "cost_per_1_k_tokens" => "cost_per_1k_tokens",
        "iso_3" => "iso3",
        "kpi_1_month_mrr" => "kpi_1month_mrr",
        "kpi_3_months_mrr" => "kpi_3months_mrr",
        "kpi_12_months_mrr" => "kpi_12months_mrr",
        "normalized_e_164" => "normalized_e164",
        "ref" => "ref_",
        "show_lots_m_2_o" => "show_lots_m2o",
        "street_2" => "street2",
        "type" => "type_",
        name => name,
    }
}

pub(crate) fn stdb_sql_field_name(column_name: &str) -> &str {
    match column_name {
        "cost_per_1_k_tokens" => "cost_per_1k_tokens",
        "iso_3" => "iso3",
        "kpi_1_month_mrr" => "kpi_1month_mrr",
        "kpi_3_months_mrr" => "kpi_3months_mrr",
        "kpi_12_months_mrr" => "kpi_12months_mrr",
        "normalized_e_164" => "normalized_e164",
        "show_lots_m_2_o" => "show_lots_m2o",
        "street_2" => "street2",
        name => name,
    }
}

pub(crate) fn normalize_stdb_digest_row(
    columns: &[pg_codec::ColumnCodec],
    row: Value,
) -> Result<Value> {
    let mut source = row
        .as_object()
        .cloned()
        .context("STDB reconstruction digest row must be an object")?;
    let mut durable = serde_json::Map::new();
    for column in columns {
        let durable_key = pg_codec::snake_to_camel(&column.name);
        let stdb_key = stdb_sql_field_name(&column.name);
        let value = source.remove(stdb_key).with_context(|| {
            format!("STDB reconstruction digest row lacks generated column '{stdb_key}'")
        })?;
        durable.insert(durable_key, canonical_sats_to_durable(column, value)?);
    }
    Ok(Value::Object(durable))
}

fn canonical_sats_to_durable(column: &pg_codec::ColumnCodec, value: Value) -> Result<Value> {
    let value = if column.nullable {
        let object = value
            .as_object()
            .context("nullable STDB digest value must be a canonical SATS Option")?;
        if object.len() != 1 {
            bail!("nullable STDB digest value must have one SATS Option variant");
        }
        if object.contains_key("none") {
            return Ok(Value::Null);
        }
        object
            .get("some")
            .cloned()
            .context("nullable STDB digest value lacks some/none variant")?
    } else {
        value
    };

    if column.pg_type == "JSONB" && column.stdb_type == "String" {
        let json = value
            .as_str()
            .context("canonical STDB protocol JSON digest value must be a string")?;
        return serde_json::from_str(json).context("parse canonical STDB protocol JSON digest");
    }

    match column.stdb_type.as_str() {
        "Identity" => {
            let identity = value
                .get("__identity__")
                .and_then(Value::as_str)
                .context("canonical STDB Identity digest value is malformed")?;
            Ok(Value::String(identity.trim_start_matches("0x").to_owned()))
        }
        "Timestamp" => {
            let micros = value
                .get("__timestamp_micros_since_unix_epoch__")
                .and_then(Value::as_i64)
                .context("canonical STDB Timestamp digest value is malformed")?;
            Ok(json!({"microsSinceUnixEpoch": micros}))
        }
        kind if kind.starts_with("Enum(") => {
            let object = value
                .as_object()
                .context("canonical STDB enum digest value must be an object")?;
            if object.len() != 1 {
                bail!("canonical STDB enum digest value must contain one variant");
            }
            Ok(Value::String(
                object
                    .keys()
                    .next()
                    .expect("length checked above")
                    .to_owned(),
            ))
        }
        _ => Ok(value),
    }
}

fn durable_value_to_sats(column: &pg_codec::ColumnCodec, value: &Value) -> Result<Value> {
    let value = if value.is_null() {
        Value::Null
    } else if column.pg_type == "JSONB" && column.stdb_type == "String" {
        Value::String(
            serde_json::to_string(value).context("serialize durable protocol JSON for STDB")?,
        )
    } else {
        match column.stdb_type.as_str() {
            "Identity" => {
                let identity = value
                    .as_str()
                    .context("durable Identity must be a hexadecimal string")?;
                json!({"__identity__": format!("0x{}", identity.trim_start_matches("0x"))})
            }
            "Timestamp" => {
                let micros = value
                    .get("microsSinceUnixEpoch")
                    .or_else(|| value.get("__timestamp_micros_since_unix_epoch__"))
                    .and_then(Value::as_i64)
                    .context("durable Timestamp must contain signed microseconds")?;
                json!({"__timestamp_micros_since_unix_epoch__": micros})
            }
            kind if kind.starts_with("Enum(") => {
                let variant = value
                    .as_str()
                    .context("durable enum must be stored as its variant name")?;
                json!({pg_codec::stdb_enum_variant(variant): []})
            }
            _ => value.clone(),
        }
    };
    if column.nullable {
        if value.is_null() {
            Ok(json!({"none": []}))
        } else {
            Ok(json!({"some": value}))
        }
    } else if value.is_null() {
        bail!("non-nullable durable value is null for '{}'", column.name)
    } else {
        Ok(value)
    }
}

fn failure_injection_enabled(
    value: Option<&str>,
    host: &str,
    disposable: Option<&str>,
) -> Result<bool> {
    let Some(value) = value else {
        return Ok(false);
    };
    if value != "1" {
        bail!("C7_INJECT_FAILURE_AFTER_BATCH must be exactly 1 when set");
    }
    let loopback = host.starts_with("http://127.0.0.1") || host.starts_with("http://localhost");
    if disposable != Some("1") || !loopback {
        bail!("C7 failure injection requires C7_DISPOSABLE_STDB=1 and a loopback STDB host");
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_sats_to_durable, canonical_stdb_row_json, durable_value_to_sats,
        failure_injection_enabled, normalize_stdb_digest_row, rust_field_name, stdb_sql_field_name,
    };
    use crate::cold_tier::pg_codec;
    use serde_json::{json, Value};

    #[test]
    fn failure_injection_is_disposable_and_loopback_only() {
        assert!(
            !failure_injection_enabled(None, "https://maincloud.spacetimedb.com", None).unwrap()
        );
        assert!(failure_injection_enabled(Some("1"), "http://127.0.0.1:3000", Some("1")).unwrap());
        assert!(failure_injection_enabled(
            Some("1"),
            "https://maincloud.spacetimedb.com",
            Some("1")
        )
        .is_err());
        assert!(failure_injection_enabled(Some("1"), "http://localhost:3000", None).is_err());
    }

    #[test]
    fn reconstruction_rows_use_stdb_rust_field_names() {
        let columns = pg_codec::load_columns(
            lumiere_contracts::manifests::PROJECTION_CODEC_MANIFEST,
            "organization_commit_cursor",
        )
        .unwrap();
        let encoded = canonical_stdb_row_json(
            &columns,
            &json!({ "organizationId": "42", "nextSequence": "2" }),
        )
        .unwrap();
        assert_eq!(encoded, r#"{"next_sequence":"2","organization_id":"42"}"#);
    }

    #[test]
    fn durable_scalars_restore_canonical_sats_wrappers() {
        let nullable_enum = pg_codec::ColumnCodec {
            name: "state".to_owned(),
            pg_type: "TEXT".to_owned(),
            stdb_type: "Enum(\"State\")".to_owned(),
            nullable: true,
        };
        assert_eq!(
            durable_value_to_sats(&nullable_enum, &json!("Posted")).unwrap(),
            json!({"some": {"Posted": []}})
        );
        assert_eq!(pg_codec::stdb_enum_variant("none"), "None");
        assert_eq!(
            durable_value_to_sats(&nullable_enum, &Value::Null).unwrap(),
            json!({"none": []})
        );

        let timestamp = pg_codec::ColumnCodec {
            name: "created_at".to_owned(),
            pg_type: "BIGINT".to_owned(),
            stdb_type: "Timestamp".to_owned(),
            nullable: false,
        };
        assert_eq!(
            durable_value_to_sats(&timestamp, &json!({"microsSinceUnixEpoch": 42})).unwrap(),
            json!({"__timestamp_micros_since_unix_epoch__": 42})
        );
    }

    #[test]
    fn protocol_jsonb_round_trips_through_stdb_string() {
        let protocol_json = pg_codec::ColumnCodec {
            name: "row_identity_json".to_owned(),
            pg_type: "JSONB".to_owned(),
            stdb_type: "String".to_owned(),
            nullable: false,
        };
        let durable = json!({"id": 42});
        let sats = durable_value_to_sats(&protocol_json, &durable).unwrap();
        assert_eq!(sats, json!(r#"{"id":42}"#));
        assert_eq!(
            canonical_sats_to_durable(&protocol_json, sats).unwrap(),
            durable
        );
    }

    #[test]
    fn reconstruction_escapes_generated_rust_keyword_fields() {
        assert_eq!(rust_field_name("type"), "type_");
        assert_eq!(rust_field_name("ref"), "ref_");
        assert_eq!(stdb_sql_field_name("type"), "type");
        assert_eq!(rust_field_name("organization_id"), "organization_id");
    }

    #[test]
    fn reconstruction_maps_generated_digit_boundary_names() {
        for (generated, stdb) in [
            ("cost_per_1_k_tokens", "cost_per_1k_tokens"),
            ("iso_3", "iso3"),
            ("kpi_1_month_mrr", "kpi_1month_mrr"),
            ("kpi_3_months_mrr", "kpi_3months_mrr"),
            ("kpi_12_months_mrr", "kpi_12months_mrr"),
            ("normalized_e_164", "normalized_e164"),
            ("show_lots_m_2_o", "show_lots_m2o"),
            ("street_2", "street2"),
        ] {
            assert_eq!(rust_field_name(generated), stdb);
            assert_eq!(stdb_sql_field_name(generated), stdb);
        }
    }

    #[test]
    fn reconstruction_digest_normalizes_identity_to_durable_hex() {
        let columns = vec![pg_codec::ColumnCodec {
            name: "create_uid".to_owned(),
            pg_type: "BYTEA".to_owned(),
            stdb_type: "Identity".to_owned(),
            nullable: true,
        }];
        assert_eq!(
            normalize_stdb_digest_row(
                &columns,
                json!({"create_uid": {"some": {"__identity__": format!("0x{}", "ab".repeat(32))}}}),
            )
            .unwrap(),
            json!({"createUid": "ab".repeat(32)})
        );
        assert_eq!(
            normalize_stdb_digest_row(&columns, json!({"create_uid": {"none": []}})).unwrap(),
            json!({"createUid": null})
        );
    }

    #[test]
    fn reconstruction_digest_maps_stdb_digit_boundary_to_durable_name() {
        let columns = vec![pg_codec::ColumnCodec {
            name: "cost_per_1_k_tokens".to_owned(),
            pg_type: "DOUBLE PRECISION".to_owned(),
            stdb_type: "F64".to_owned(),
            nullable: false,
        }];
        assert_eq!(
            normalize_stdb_digest_row(&columns, json!({"cost_per_1k_tokens": 0.003})).unwrap(),
            json!({"costPer1KTokens": 0.003})
        );
    }

    #[test]
    fn reconstruction_digest_preserves_nested_canonical_sats() {
        let columns = vec![pg_codec::ColumnCodec {
            name: "user_ids".to_owned(),
            pg_type: "JSONB".to_owned(),
            stdb_type: "Vec(Identity)".to_owned(),
            nullable: false,
        }];
        let identities = json!([{"__identity__": format!("0x{}", "cd".repeat(32))}]);
        assert_eq!(
            normalize_stdb_digest_row(&columns, json!({"user_ids": identities.clone()})).unwrap(),
            json!({"userIds": identities})
        );
    }
}
