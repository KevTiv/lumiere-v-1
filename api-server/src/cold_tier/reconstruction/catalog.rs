//! Reconstruction catalog and manifest validation.

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};

use super::RECONSTRUCTION_MANIFEST_JSON;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct RestoreTable {
    pub table: String,
    pub module: String,
    pub state_class: String,
    pub required_for_activation: bool,
    pub restore_order: u32,
    pub dependencies: Vec<String>,
    pub primary_key: String,
    pub organization_column: String,
    pub projection_mode: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoreCatalog {
    tables: Vec<RestoreTable>,
    recreate_order: Vec<String>,
    excluded_tables: Vec<String>,
}

#[derive(Deserialize)]
struct Manifest {
    version: u64,
    tables: Vec<RestoreTable>,
    #[serde(default)]
    recreate_order: Vec<String>,
    #[serde(default)]
    excluded_tables: Vec<String>,
}

impl RestoreCatalog {
    /// Parse generated/reviewed metadata. Unknown fields are tolerated, but
    /// all recovery-critical fields are mandatory through `RestoreTable`.
    pub fn from_manifest(json: &str) -> Result<Self> {
        let mut manifest: Manifest =
            serde_json::from_str(json).context("parse reconstruction manifest")?;
        if manifest.version != 1 || manifest.tables.is_empty() {
            bail!("reconstruction manifest has unsupported version or no tables");
        }
        let mut names = BTreeSet::new();
        let mut orders = BTreeSet::new();
        for table in &manifest.tables {
            for (_, value) in [
                ("table", table.table.as_str()),
                ("module", table.module.as_str()),
                ("primary key", table.primary_key.as_str()),
            ] {
                super::super::conventions::validate_identifier(value)?;
            }
            if table.organization_column != "organization_id"
                || !matches!(
                    table.projection_mode.as_str(),
                    "upsert-current" | "append-history"
                )
            {
                bail!(
                    "reconstruction table '{}' has unsupported ownership or projection mode",
                    table.table
                );
            }
            if !names.insert(table.table.clone()) || !orders.insert(table.restore_order) {
                bail!("duplicate reconstruction table or restore order");
            }
        }
        let order: BTreeMap<_, _> = manifest
            .tables
            .iter()
            .map(|table| (table.table.as_str(), table.restore_order))
            .collect();
        for table in &manifest.tables {
            for dependency in &table.dependencies {
                if !matches!(
                    order.get(dependency.as_str()),
                    Some(value) if *value < table.restore_order
                ) {
                    bail!(
                        "reconstruction dependency '{dependency}' must precede '{}'",
                        table.table
                    );
                }
            }
        }
        let mut classified = names.clone();
        for (_, tables) in [
            ("recreated", &manifest.recreate_order),
            ("excluded", &manifest.excluded_tables),
        ] {
            for table in tables {
                super::super::conventions::validate_identifier(table)?;
                if !classified.insert(table.clone()) {
                    bail!("reconstruction table '{table}' has multiple classifications");
                }
            }
        }
        manifest.tables.sort_by_key(|table| table.restore_order);
        Ok(Self {
            tables: manifest.tables,
            recreate_order: manifest.recreate_order,
            excluded_tables: manifest.excluded_tables,
        })
    }

    pub fn generated() -> Result<Self> {
        Self::from_manifest(RECONSTRUCTION_MANIFEST_JSON)
    }

    pub fn tables(&self) -> &[RestoreTable] {
        &self.tables
    }

    pub fn recreate_order(&self) -> &[String] {
        &self.recreate_order
    }

    pub fn excluded_tables(&self) -> &[String] {
        &self.excluded_tables
    }
}
