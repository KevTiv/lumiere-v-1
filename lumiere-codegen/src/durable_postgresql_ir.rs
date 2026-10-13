//! All PostgreSQL DDL emission after the canonical v2 contract handoff.
//!
//! This adapter reads no SDK bindings or domain source. Projection codec
//! columns and storage policies own the durable layout; the canonical raw
//! tables/types supply column identities, keys, and indexed column positions.
//! The existing renderer and frozen ledger keep released SQL byte-identical.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{bail, Context, Result};
use serde_json::Value;

use crate::cold_tier::codec_emit::durable_pg_type;
use crate::cold_tier::pg_migration_emit::{self, DurableMigrationSet, MigrationLedger};
use crate::cold_tier::schema_ir::{
    GeneratedColumn, GeneratedIndex, GeneratedPrimaryKey, GeneratedTableSchema, GeneratedType,
    LumiereSchemaManifest,
};
use crate::paths::Paths;
use crate::support::{read_to_string, write_file};

pub fn run(paths: &Paths) -> Result<()> {
    let ir: Value = serde_json::from_str(&read_to_string(&paths.contract_ir_out)?)
        .context("parse canonical IR for durable PostgreSQL emission")?;
    let ledger = MigrationLedger::load(&paths.durable_migration_ledger_dir)?;
    let artifacts = emit(&ir, &ledger)?;
    let cold_artifacts = emit_cold_artifacts(&ir)?;
    // Earlier schema planning supplies hydration/reconstruction/read manifests.
    // It cannot authorize different DDL from the canonical handoff.
    let planned: Value =
        serde_json::from_str(&read_to_string(&paths.durable_migration_manifest_out)?)?;
    let actual: Value = serde_json::from_str(&artifacts.manifest)?;
    if planned != actual {
        bail!("canonical IR durable schema differs from prerequisite schema planning");
    }
    for (filename, ddl) in cold_artifacts {
        let path = paths.cold_ddl_dir.join(filename);
        write_file(&path, &ddl)?;
        println!("Wrote {} from canonical IR", path.display());
    }
    for migration in &artifacts.migrations {
        let path = paths
            .durable_migration_dir
            .join(format!("{}.sql", migration.name));
        write_file(&path, &migration.sql)?;
        println!(
            "Wrote {} from canonical IR ({}, checksum {})",
            path.display(),
            if migration.released {
                "released, frozen"
            } else {
                "pending"
            },
            migration.checksum
        );
    }
    write_file(&paths.durable_migration_manifest_out, &artifacts.manifest)?;
    Ok(())
}

fn emit_cold_artifacts(ir: &Value) -> Result<BTreeMap<String, String>> {
    let schema = schema_from_ir(ir)?;
    let candidates = ir["persistence"]["postgresql"]["archive"]["candidates"]
        .as_array()
        .context("canonical archive candidates missing")?;
    for candidate in candidates {
        for field in ["table", "cold_table"] {
            if !candidate[field].as_str().is_some_and(valid_identifier) {
                bail!("invalid canonical archive SQL identifier {field}");
            }
        }
    }
    let mut artifacts = BTreeMap::new();
    for (name, ddl) in crate::cold_tier::emit_archive_ddl(&schema, candidates)? {
        if artifacts.insert(name, ddl).is_some() {
            bail!("duplicate canonical archive SQL artifact");
        }
    }
    crate::read_ir::validate_postgres_access_paths(
        &serde_json::to_string(&ir["persistence"]["reads"])?,
        &serde_json::to_string(&ir["persistence"]["storage"])?,
        &artifacts,
    )?;
    let stream = &ir["persistence"]["commit_stream"];
    for (field, expected) in [
        ("envelope_table", "organization_commit"),
        ("row_change_table", "organization_row_change"),
        ("sequence_scope", "organization_id"),
        ("sequence_order", "strictly_monotonic"),
        ("contract_version", "ir-v2"),
        ("upsert_payload", "canonical_full_row_json"),
        ("delete_payload", "durable_identity_tombstone"),
    ] {
        if stream[field].as_str() != Some(expected) {
            bail!("unsupported canonical commit-stream bootstrap contract {field}");
        }
    }
    // PG-only watermark/quarantine/status tables are the existing projection
    // protocol implementation, not business schema. Keep its bootstrap bytes
    // frozen, but authorize it only from the canonical commit-stream contract.
    for (name, ddl) in crate::cold_tier::pg_ddl_emit::emit_commit_stream_ddl() {
        let table_name = name
            .strip_suffix(".sql")
            .context("projection protocol bootstrap artifact lacks SQL suffix")?;
        if let Some(table) = schema
            .tables
            .iter()
            .find(|table| table.sql_name == table_name)
        {
            // Validate every STDB-backed protocol column against the canonical
            // projection codec, so a template cannot silently drift from IR.
            let declared = ddl
                .lines()
                .skip(2)
                .take_while(|line| !line.trim_start().starts_with("CONSTRAINT"))
                .filter(|line| !line.trim().is_empty())
                .count();
            if declared != table.columns.len() {
                bail!("canonical protocol bootstrap column census mismatch for {table_name}");
            }
            for column in &table.columns {
                let declaration = format!(
                    "    {} {}{},",
                    column.sql_name,
                    durable_pg_type(table_name, &column.sql_name, &column.ty),
                    if column.nullable { "" } else { " NOT NULL" }
                );
                if !ddl.lines().any(|line| line == declaration) {
                    bail!(
                        "canonical protocol bootstrap column mismatch for {table_name}.{}",
                        column.sql_name
                    );
                }
            }
        } else if matches!(
            table_name,
            "organization_commit" | "organization_row_change"
        ) {
            bail!("canonical commit-stream table missing: {table_name}");
        }
        if artifacts.insert(name.to_string(), ddl).is_some() {
            bail!("canonical archive collides with projection protocol bootstrap");
        }
    }
    Ok(artifacts)
}

pub fn emit(ir: &Value, ledger: &MigrationLedger) -> Result<DurableMigrationSet> {
    let schema = schema_from_ir(ir)?;
    pg_migration_emit::emit_durable_migrations(&schema, &ir["persistence"]["storage"], ledger)
        .context("render durable PostgreSQL exclusively from canonical IR")
}

fn logical_type(value: &str) -> Result<GeneratedType> {
    Ok(match value {
        "U8" => GeneratedType::U8,
        "U16" => GeneratedType::U16,
        "U32" => GeneratedType::U32,
        "U64" => GeneratedType::U64,
        "I8" => GeneratedType::I8,
        "I16" => GeneratedType::I16,
        "I32" => GeneratedType::I32,
        "I64" => GeneratedType::I64,
        "F32" => GeneratedType::F32,
        "F64" => GeneratedType::F64,
        "Bool" => GeneratedType::Bool,
        "String" => GeneratedType::String,
        "Identity" => GeneratedType::Identity,
        "Timestamp" => GeneratedType::Timestamp,
        other => {
            if let Some(inner) = other.strip_prefix("Vec(").and_then(|v| v.strip_suffix(')')) {
                GeneratedType::Vec(Box::new(logical_type(inner)?))
            } else if let Some(inner) = other
                .strip_prefix("Enum(")
                .and_then(|v| v.strip_suffix(')'))
            {
                GeneratedType::Enum(serde_json::from_str(inner).context("IR enum type name")?)
            } else if let Some(inner) = other
                .strip_prefix("Struct(")
                .and_then(|v| v.strip_suffix(')'))
            {
                GeneratedType::Struct(serde_json::from_str(inner).context("IR struct type name")?)
            } else {
                bail!("unsupported canonical projection logical type {other:?}");
            }
        }
    })
}

fn positions(value: &Value, count: usize) -> Result<Vec<usize>> {
    let positions: Vec<usize> = value
        .as_array()
        .context("canonical index/key column positions must be an array")?
        .iter()
        .map(|position| {
            let index = position
                .as_u64()
                .and_then(|v| usize::try_from(v).ok())
                .context("canonical column position must be an unsigned integer")?;
            if index >= count {
                bail!("canonical column position {index} is out of bounds");
            }
            Ok(index)
        })
        .collect::<Result<_>>()?;
    if positions.is_empty()
        || positions.iter().copied().collect::<BTreeSet<_>>().len() != positions.len()
    {
        bail!("canonical key/index positions must be nonempty and distinct");
    }
    Ok(positions)
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().enumerate().all(|(index, byte)| {
            byte == b'_' || byte.is_ascii_alphabetic() || (index > 0 && byte.is_ascii_digit())
        })
}

fn raw_nullable<'a>(mut algebraic: &'a Value, types: &BTreeMap<u64, &'a Value>) -> Result<bool> {
    let mut visited = BTreeSet::new();
    while let Some(reference) = algebraic["Ref"].as_u64() {
        if !visited.insert(reference) {
            bail!("cyclic canonical column type reference");
        }
        algebraic = &types
            .get(&reference)
            .context("unknown canonical column type reference")?["definition"];
    }
    Ok(algebraic["Sum"]["variants"]
        .as_array()
        .is_some_and(|variants| {
            variants.len() == 2
                && variants.iter().any(|v| v["name"]["some"] == "some")
                && variants.iter().any(|v| v["name"]["some"] == "none")
        }))
}

fn validate_raw_type(
    algebraic: &Value,
    types: &BTreeMap<u64, &Value>,
    expected: &GeneratedType,
    depth: usize,
) -> Result<()> {
    if depth > 128 {
        bail!("canonical logical type reference depth exceeds limit");
    }
    if let Some(reference) = algebraic["Ref"].as_u64() {
        let definition = types
            .get(&reference)
            .context("unknown canonical logical type reference")?;
        if let GeneratedType::Enum(name) | GeneratedType::Struct(name) = expected {
            let expected_kind = if matches!(expected, GeneratedType::Enum(_)) {
                "Sum"
            } else {
                "Product"
            };
            if !definition["names"]
                .as_array()
                .is_some_and(|names| names.iter().any(|v| v.as_str() == Some(name)))
                || definition["definition"][expected_kind].is_null()
            {
                bail!("canonical named logical type disagrees with projection codec");
            }
            return Ok(());
        }
        return validate_raw_type(&definition["definition"], types, expected, depth + 1);
    }
    if let Some(variants) = algebraic["Sum"]["variants"].as_array() {
        if variants.len() == 2 && variants.iter().any(|v| v["name"]["some"] == "none") {
            if let Some(some) = variants.iter().find(|v| v["name"]["some"] == "some") {
                return validate_raw_type(&some["algebraic_type"], types, expected, depth + 1);
            }
        }
    }
    match expected {
        GeneratedType::Vec(inner) => {
            if algebraic["Array"].is_null() {
                bail!("canonical array type disagrees with projection codec");
            }
            validate_raw_type(&algebraic["Array"], types, inner, depth + 1)
        }
        GeneratedType::Identity | GeneratedType::Timestamp => {
            let (name, scalar) = if matches!(expected, GeneratedType::Identity) {
                ("__identity__", "U256")
            } else {
                ("__timestamp_micros_since_unix_epoch__", "I64")
            };
            let elements = algebraic["Product"]["elements"]
                .as_array()
                .context("canonical builtin wrapper must be a product")?;
            if elements.len() != 1
                || elements[0]["name"]["some"].as_str() != Some(name)
                || elements[0]["algebraic_type"][scalar].is_null()
            {
                bail!("canonical builtin type disagrees with projection codec");
            }
            Ok(())
        }
        GeneratedType::Struct(name) if name == "ScheduleAt" => {
            // SDK ScheduleAt is an inline algebraic sum but its canonical JSON
            // codec is object-valued (the frozen normalized IR calls it Struct).
            let variants = algebraic["Sum"]["variants"]
                .as_array()
                .context("canonical ScheduleAt must be a sum")?;
            if variants.len() != 2 {
                bail!("invalid canonical ScheduleAt variants");
            }
            for (variant_name, marker) in [
                ("Interval", "__time_duration_micros__"),
                ("Time", "__timestamp_micros_since_unix_epoch__"),
            ] {
                let variant = variants
                    .iter()
                    .find(|variant| variant["name"]["some"] == variant_name)
                    .context("canonical ScheduleAt variant missing")?;
                let elements = variant["algebraic_type"]["Product"]["elements"]
                    .as_array()
                    .context("canonical ScheduleAt variant must be a product")?;
                if elements.len() != 1
                    || elements[0]["name"]["some"] != marker
                    || elements[0]["algebraic_type"]["I64"].is_null()
                {
                    bail!("invalid canonical ScheduleAt variant payload");
                }
            }
            Ok(())
        }
        GeneratedType::Enum(_) | GeneratedType::Struct(_) => {
            bail!("canonical named type requires a matching type reference")
        }
        scalar => {
            if algebraic[format!("{scalar:?}")].is_null() {
                bail!("canonical scalar type disagrees with projection codec");
            }
            Ok(())
        }
    }
}

fn schema_from_ir(ir: &Value) -> Result<LumiereSchemaManifest> {
    if ir["ir_version"] != 2
        || ir["persistence"]["schema_version"] != 1
        || ir["persistence"]["storage"]["version"] != 1
        || ir["persistence"]["postgresql"]["projection"]["version"] != 1
    {
        bail!("durable PostgreSQL requires the canonical v2 persistence contract");
    }
    let projection = ir["persistence"]["postgresql"]["projection"]["tables"]
        .as_object()
        .context("canonical projection tables must be an object")?;
    let raw_tables = ir["tables"]
        .as_array()
        .context("canonical raw tables must be an array")?;
    let mut types = BTreeMap::new();
    for entry in ir["types"]
        .as_array()
        .context("canonical types must be an array")?
    {
        let index = entry["index"]
            .as_u64()
            .context("canonical type index missing")?;
        if types.insert(index, entry).is_some() {
            bail!("duplicate canonical type index {index}");
        }
    }
    let mut names = BTreeSet::new();
    let mut tables = Vec::with_capacity(raw_tables.len());
    for raw in raw_tables {
        let name = raw["name"]
            .as_str()
            .context("canonical table name missing")?;
        if !valid_identifier(name) {
            bail!("invalid canonical SQL table identifier");
        }
        if !names.insert(name) {
            bail!("duplicate canonical table {name}");
        }
        let codec = projection
            .get(name)
            .with_context(|| format!("canonical projection lacks table {name}"))?;
        if codec["projection_table"].as_str() != Some(name) {
            bail!("canonical projection identity mismatch for {name}");
        }
        let row_type = raw["product_type_ref"]
            .as_u64()
            .context("canonical row type reference missing")?;
        let definition = types
            .get(&row_type)
            .context("canonical row type reference is unknown")?;
        let elements = definition["definition"]["Product"]["elements"]
            .as_array()
            .context("canonical row type must be a product")?;
        let codec_columns = codec["columns"]
            .as_array()
            .context("canonical projection columns missing")?;
        if elements.len() != codec_columns.len() {
            bail!("canonical column census mismatch for {name}");
        }
        let mut column_names = BTreeSet::new();
        let mut columns = Vec::with_capacity(elements.len());
        for (element, codec_column) in elements.iter().zip(codec_columns) {
            let column_name = element["name"]["some"]
                .as_str()
                .context("canonical column name missing")?;
            if !valid_identifier(column_name) {
                bail!("invalid canonical SQL column identifier");
            }
            if !column_names.insert(column_name) {
                bail!("duplicate canonical column {name}.{column_name}");
            }
            if codec_column["name"].as_str() != Some(column_name) {
                bail!("canonical projection column order/identity mismatch for {name}");
            }
            let ty = logical_type(
                codec_column["stdb_type"]
                    .as_str()
                    .context("projection logical type missing")?,
            )?;
            let nullable = codec_column["nullable"]
                .as_bool()
                .context("projection nullable flag missing")?;
            if nullable != raw_nullable(&element["algebraic_type"], &types)? {
                bail!("canonical raw nullable contract disagrees with projection for {name}.{column_name}");
            }
            validate_raw_type(&element["algebraic_type"], &types, &ty, 0).with_context(|| {
                format!("validate canonical logical type for {name}.{column_name}")
            })?;
            if codec_column["pg_type"].as_str() != Some(durable_pg_type(name, column_name, &ty)) {
                bail!("canonical PostgreSQL type disagrees with projection codec for {name}.{column_name}");
            }
            columns.push(GeneratedColumn {
                name: column_name.to_string(),
                sql_name: column_name.to_string(),
                ty,
                nullable,
            });
        }
        let pk = positions(&raw["primary_key"], columns.len())?;
        if pk.len() != 1 {
            bail!("canonical durable renderer requires a single-column primary key for {name}");
        }
        let pk_column = &columns[pk[0]];
        if pk_column.nullable
            || codec["primary_key"]["name"].as_str() != Some(pk_column.name.as_str())
            || codec["primary_key"]["type"].as_str() != Some(format!("{:?}", pk_column.ty).as_str())
        {
            bail!("canonical primary-key contract mismatch for {name}");
        }
        let mut unique_columns = BTreeSet::new();
        for constraint in raw["constraints"]
            .as_array()
            .context("canonical table constraints missing")?
        {
            let unique = &constraint["data"]["Unique"]["columns"];
            if unique.is_null() {
                bail!("unsupported canonical constraint for {name}");
            }
            let cols = positions(unique, columns.len())?;
            if cols.len() == 1 {
                unique_columns.insert(cols[0]);
            }
        }
        // Frozen durable SQL uses scalar indexed columns, alphabetically sorted
        // and named table_column. Composite STDB access paths remain in the IR
        // but adding them to PG requires an explicit future layout migration.
        let mut indexed = BTreeSet::new();
        for index in raw["indexes"]
            .as_array()
            .context("canonical table indexes missing")?
        {
            let cols = positions(&index["algorithm"]["BTree"], columns.len())?;
            if cols.len() == 1 && cols[0] != pk[0] {
                indexed.insert(columns[cols[0]].name.clone());
            }
        }
        let indexes = indexed
            .into_iter()
            .map(|column| {
                let index = columns
                    .iter()
                    .position(|value| value.name == column)
                    .expect("validated canonical column");
                GeneratedIndex {
                    name: format!("{name}_{column}"),
                    columns: vec![column],
                    unique: unique_columns.contains(&index),
                }
            })
            .collect();
        tables.push(GeneratedTableSchema {
            rust_name: definition["names"]
                .as_array()
                .and_then(|v| v.first())
                .and_then(Value::as_str)
                .context("canonical row type name missing")?
                .to_string(),
            sql_name: name.to_string(),
            primary_key: GeneratedPrimaryKey {
                column_name: pk_column.name.clone(),
                ty: pk_column.ty.clone(),
            },
            columns,
            indexes,
        });
    }
    if projection.len() != names.len() {
        bail!("canonical projection has unowned table entries");
    }
    tables.sort_by(|left, right| left.sql_name.cmp(&right.sql_name));
    Ok(LumiereSchemaManifest {
        version: 1,
        tables,
        enum_types: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::Path;

    fn fixture() -> Value {
        json!({
            "ir_version": 2,
            "tables": [{"name":"example", "product_type_ref":0, "primary_key":[0],
                "constraints":[{"data":{"Unique":{"columns":[0]}}}],
                "indexes":[{"algorithm":{"BTree":[1]}},{"algorithm":{"BTree":[0]}},
                    {"algorithm":{"BTree":[1,2]}}]}],
            "types":[{"index":0,"names":["Example"],"definition":{"Product":{"elements":[
                {"name":{"some":"id"},"algebraic_type":{"U64":[]}},
                {"name":{"some":"organization_id"},"algebraic_type":{"U64":[]}},
                {"name":{"some":"name"},"algebraic_type":{"String":[]}}
            ]}}}],
            "persistence":{"schema_version":1,"storage":{"version":1,"policies":[{
                "table":"example","module":"core","projection_mode":"upsert-current",
                "postgres_access_path":"organization_index","organization_column":"organization_id",
                "organization_ownership":"direct"}]},
                "postgresql":{"projection":{"version":1,"tables":{"example":{
                    "projection_table":"example","primary_key":{"name":"id","type":"U64"},
                    "columns":[
                        {"name":"id","stdb_type":"U64","pg_type":"NUMERIC(20,0)","nullable":false},
                        {"name":"organization_id","stdb_type":"U64","pg_type":"NUMERIC(20,0)","nullable":false},
                        {"name":"name","stdb_type":"String","pg_type":"TEXT","nullable":false}
                    ]
                }}}}}
        })
    }

    #[test]
    fn canonical_adapter_preserves_frozen_scalar_index_layout_and_types() {
        let schema = schema_from_ir(&fixture()).expect("valid canonical fixture");
        assert_eq!(schema.tables.len(), 1);
        assert_eq!(schema.tables[0].indexes.len(), 1);
        assert_eq!(schema.tables[0].indexes[0].name, "example_organization_id");
        assert_eq!(schema.tables[0].primary_key.ty, GeneratedType::U64);
        assert_eq!(
            logical_type("Vec(Enum(\"State\"))").unwrap(),
            GeneratedType::Vec(Box::new(GeneratedType::Enum("State".to_string())))
        );
        let rendered = pg_migration_emit::emit_durable_migration(
            &schema,
            &fixture()["persistence"]["storage"],
        )
        .expect("render adapted fixture");
        assert!(rendered.sql.contains("\"id\" NUMERIC(20,0) NOT NULL"));
        assert!(rendered
            .sql
            .contains("CREATE INDEX IF NOT EXISTS \"example_organization_id\""));
        assert!(!rendered.sql.contains("example_organization_id_name"));
    }

    #[test]
    fn malformed_or_inconsistent_handoff_fails_closed() {
        let mutations = [
            ("/ir_version", json!(1)),
            ("/types/0/index", json!(2)),
            ("/tables/0/primary_key", json!([0, 1])),
            ("/tables/0/indexes/0/algorithm/BTree", json!([99])),
            ("/tables/0/indexes/0/algorithm/BTree", json!([1, 1])),
            ("/tables/0/indexes/0/algorithm/BTree", json!([])),
            ("/tables/0/name", json!("../escape")),
            (
                "/persistence/postgresql/projection/tables/example/primary_key/name",
                json!("name"),
            ),
            (
                "/persistence/postgresql/projection/tables/example/columns/0/pg_type",
                json!("BIGINT"),
            ),
            (
                "/persistence/postgresql/projection/tables/example/columns/0/nullable",
                json!(true),
            ),
            (
                "/persistence/postgresql/projection/tables/example/columns/0/name",
                json!("wrong"),
            ),
            (
                "/persistence/postgresql/projection/tables/example/columns/0/stdb_type",
                json!("UnknownType"),
            ),
            (
                "/types/0/definition/Product/elements/2/algebraic_type",
                json!({"U64":[]}),
            ),
        ];
        for (pointer, value) in mutations {
            let mut ir = fixture();
            *ir.pointer_mut(pointer).unwrap() = value;
            assert!(schema_from_ir(&ir).is_err(), "accepted malformed {pointer}");
        }
        let mut ir = fixture();
        let duplicate = ir["tables"][0].clone();
        ir["tables"].as_array_mut().unwrap().push(duplicate);
        assert!(schema_from_ir(&ir).is_err());
    }

    #[test]
    #[ignore = "requires generated canonical staging; run explicitly with CONTRACTS_STAGING_DIR"]
    fn current_canonical_handoff_matches_all_released_migrations_and_manifest() {
        let paths = Paths::resolve(Path::new(env!("CARGO_MANIFEST_DIR")));
        let ir: Value =
            serde_json::from_str(&read_to_string(&paths.contract_ir_out).unwrap()).unwrap();
        let schema: LumiereSchemaManifest =
            serde_json::from_str(&read_to_string(&paths.schema_manifest_out).unwrap()).unwrap();
        let storage: Value =
            serde_json::from_str(&read_to_string(&paths.storage_policy_manifest_out).unwrap())
                .unwrap();
        let ledger = MigrationLedger::load(&paths.durable_migration_ledger_dir).unwrap();
        let existing =
            pg_migration_emit::emit_durable_migrations(&schema, &storage, &ledger).unwrap();
        let canonical = emit(&ir, &ledger).unwrap();
        assert_eq!(
            canonical, existing,
            "canonical handoff must preserve exact SQL, checksums, and manifest"
        );
        for released in &ledger.released {
            let emitted = canonical
                .migrations
                .iter()
                .find(|value| value.version == released.version)
                .unwrap();
            assert_eq!(emitted.sql, released.sql);
            assert!(emitted.released);
        }
        let cold = emit_cold_artifacts(&ir).unwrap();
        assert_eq!(
            cold.len(),
            ir["persistence"]["postgresql"]["archive"]["candidates"]
                .as_array()
                .unwrap()
                .len()
                + 5
        );
        for (name, sql) in &cold {
            assert_eq!(
                *sql,
                read_to_string(&paths.cold_ddl_dir.join(name)).unwrap(),
                "canonical archive/protocol emission must preserve {name} bytes"
            );
        }
        let mut malformed = ir.clone();
        malformed["persistence"]["commit_stream"]["sequence_scope"] = json!("company_id");
        assert!(emit_cold_artifacts(&malformed).is_err());
        let mut malformed = ir.clone();
        malformed["persistence"]["postgresql"]["archive"]["candidates"][0]["cold_table"] =
            json!("../escape");
        assert!(emit_cold_artifacts(&malformed).is_err());
    }
}
