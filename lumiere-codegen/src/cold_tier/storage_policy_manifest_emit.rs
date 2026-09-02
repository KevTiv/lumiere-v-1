//! Complete storage-policy census and schema-aware validator.

use std::collections::{BTreeMap, BTreeSet};

const EXPECTED_SCHEMA_TABLES: usize = 458;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::cold_tier::schema_ir::{GeneratedTableOwnership, LumiereSchemaManifest};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DurabilityClass {
    DurableBusinessRecord,
    DurableHistory,
    DurableOperationalState,
    DerivedRebuildable,
    Ephemeral,
    ExternalReference,
    PlatformControl,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrganizationOwnership {
    Direct,
    PlatformGlobal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompanyOwnership {
    None,
    Direct,
    Parent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AggregateKind {
    Root,
    Child,
    Standalone,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrimaryKeyStrategy {
    AutoIncrement,
    Natural,
    Composite,
    Identity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VersionStrategy {
    None,
    UpdatedAt,
    ArchiveVersion,
    Revision,
    Sequence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectionMode {
    UpsertCurrent,
    AppendHistory,
    Snapshot,
    DerivedRebuildable,
    Ephemeral,
    ExternalReference,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HotRetention {
    Always,
    TerminalWindow,
    TimeWindow,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoolingEligibility {
    Never,
    Terminal,
    TimeWindow,
    Parent,
    Policy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DependencyBehavior {
    None,
    FollowParent,
    BlockParentCooling,
    Independent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HydrationPolicy {
    NotApplicable,
    Parent,
    Aggregate,
    FullRow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeleteBehavior {
    Tombstone,
    AppendOnly,
    Rebuild,
    External,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PostgresAccessPath {
    OrganizationPartition,
    OrganizationIndex,
    AppendSequence,
    SnapshotKey,
    DerivedOnly,
    PlatformShared,
    External,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParentReference {
    pub table: String,
    pub child_column: String,
    pub parent_column: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AggregateBoundary {
    pub kind: AggregateKind,
    pub parent: Option<ParentReference>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrimaryKeyPolicy {
    pub strategy: PrimaryKeyStrategy,
    pub column: String,
    pub version_strategy: VersionStrategy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoragePolicy {
    pub table: String,
    pub module: String,
    pub rationale: String,
    pub authoritative_resources: Vec<String>,
    pub durability_class: DurabilityClass,
    pub organization_ownership: OrganizationOwnership,
    pub organization_column: Option<String>,
    pub company_ownership: CompanyOwnership,
    pub company_column_path: Option<Vec<String>>,
    pub company_column_nullable: Option<bool>,
    pub aggregate: AggregateBoundary,
    pub primary_key: PrimaryKeyPolicy,
    pub projection_mode: ProjectionMode,
    pub hot_retention: HotRetention,
    pub cooling_eligibility: CoolingEligibility,
    pub cooling_eligibility_source: String,
    pub dependency_behavior: DependencyBehavior,
    pub hydration_policy: HydrationPolicy,
    pub delete_behavior: DeleteBehavior,
    pub postgres_access_path: PostgresAccessPath,
    #[serde(default, rename = "_comment", skip_serializing)]
    pub comment: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoragePolicyConfig {
    pub version: u32,
    pub policies: Vec<StoragePolicy>,
    #[serde(default, rename = "_comment", skip_serializing)]
    pub comment: Option<String>,
}

pub fn emit_storage_policy_manifest(
    policy_json: &str,
    schema_manifest: &LumiereSchemaManifest,
    resource_registry_json: &str,
) -> Result<String> {
    emit_storage_policy_manifest_with_expected_count(
        policy_json,
        schema_manifest,
        resource_registry_json,
        EXPECTED_SCHEMA_TABLES,
    )
}

fn emit_storage_policy_manifest_with_expected_count(
    policy_json: &str,
    schema_manifest: &LumiereSchemaManifest,
    resource_registry_json: &str,
    expected_table_count: usize,
) -> Result<String> {
    if schema_manifest.tables.len() != expected_table_count {
        bail!(
            "storage policy census requires {expected_table_count} schema tables, found {}",
            schema_manifest.tables.len()
        );
    }
    let config: StoragePolicyConfig =
        serde_json::from_str(policy_json).context("parse storage-policy-manifest.json")?;
    let coverage = validate_storage_policies(&config, schema_manifest)?;
    validate_authoritative_resources(&config, resource_registry_json)?;
    let policies = config
        .policies
        .iter()
        .map(|policy| serde_json::to_value(policy).context("serialise typed storage policy"))
        .collect::<Result<Vec<_>>>()?;
    let manifest = serde_json::json!({
        "version": config.version,
        "_comment": "Auto-generated by lumiere-codegen from storage-policy-manifest.json. Do not edit.",
        "policies": policies,
        "coverage": coverage,
    });
    serde_json::to_string_pretty(&manifest).context("serialise storage policy manifest")
}

fn validate_authoritative_resources(
    config: &StoragePolicyConfig,
    resource_registry_json: &str,
) -> Result<()> {
    let registry: serde_json::Value =
        serde_json::from_str(resource_registry_json).context("parse resource_registry.json")?;
    let resources = registry
        .as_object()
        .context("resource_registry.json root must be an object")?;
    let policy_tables = config
        .policies
        .iter()
        .map(|policy| policy.table.as_str())
        .collect::<BTreeSet<_>>();
    for (resource, entry) in resources {
        let table = entry
            .get("table")
            .and_then(serde_json::Value::as_str)
            .with_context(|| format!("resource '{resource}' has no table"))?;
        if !policy_tables.contains(table) {
            bail!("resource '{resource}' references table '{table}' without a storage policy");
        }
    }
    for policy in &config.policies {
        for resource in &policy.authoritative_resources {
            let entry = resources.get(resource).with_context(|| {
                format!(
                    "storage policy '{}': authoritative resource '{}' does not exist",
                    policy.table, resource
                )
            })?;
            if entry.get("table").and_then(serde_json::Value::as_str) != Some(policy.table.as_str())
            {
                bail!(
                    "storage policy '{}': authoritative resource '{}' maps to another table",
                    policy.table,
                    resource
                );
            }
        }
        let expected = resources
            .iter()
            .filter_map(|(resource, entry)| {
                (entry.get("table").and_then(serde_json::Value::as_str)
                    == Some(policy.table.as_str()))
                .then_some(resource.as_str())
            })
            .collect::<BTreeSet<_>>();
        let declared = policy
            .authoritative_resources
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        if declared != expected {
            bail!(
                "storage policy '{}': authoritative resource list does not exactly match the registry",
                policy.table
            );
        }
    }
    Ok(())
}

pub fn validate_storage_policies(
    config: &StoragePolicyConfig,
    schema_manifest: &LumiereSchemaManifest,
) -> Result<StoragePolicyCoverage> {
    if config.version != 1 {
        bail!("storage policy version must be 1, found {}", config.version);
    }
    let mut tables = BTreeMap::new();
    for table in &schema_manifest.tables {
        if tables.insert(table.sql_name.as_str(), table).is_some() {
            bail!(
                "schema manifest contains duplicate table '{}'",
                table.sql_name
            );
        }
    }
    let mut seen = BTreeSet::new();
    let mut by_module = BTreeMap::<String, usize>::new();

    for (index, policy) in config.policies.iter().enumerate() {
        let table_name = policy.table.trim();
        if table_name.is_empty() {
            bail!("policies[{index}].table must not be empty");
        }
        if !seen.insert(table_name.to_string()) {
            bail!("policies[{index}]: duplicate table '{table_name}'");
        }
        let table = tables.get(table_name).with_context(|| {
            format!("policies[{index}]: table '{table_name}' not found in schema manifest")
        })?;
        if policy.module.trim().is_empty() {
            bail!("policies[{index}] ('{table_name}'): module must not be empty");
        }
        if policy.rationale.trim().is_empty() {
            bail!("policies[{index}] ('{table_name}'): rationale must not be empty");
        }
        validate_c0_ownership(policy, table_name, table)?;
        validate_aggregate_and_parent(policy, table_name, table, &config.policies, &tables)?;
        validate_company_path(policy, table_name, table, &config.policies, &tables)?;
        validate_primary_key_policy(policy, table_name, table)?;
        validate_policy_coherence(policy, table_name)?;
        *by_module.entry(policy.module.clone()).or_default() += 1;
    }
    validate_aggregate_cycles(&config.policies)?;

    let total = schema_manifest.tables.len();
    let classified = config.policies.len();
    let missing = tables
        .keys()
        .filter(|table| !seen.contains(**table))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        bail!(
            "storage policy coverage incomplete: {} unclassified of {} tables; first missing: {}",
            missing.len(),
            total,
            missing
                .iter()
                .take(10)
                .copied()
                .collect::<Vec<_>>()
                .join(", ")
        );
    }
    if classified != total {
        bail!("storage policy coverage mismatch: {classified} policies for {total} schema tables");
    }
    Ok(StoragePolicyCoverage {
        classified,
        total,
        unclassified: total.saturating_sub(classified),
        by_module,
    })
}

fn validate_aggregate_cycles(policies: &[StoragePolicy]) -> Result<()> {
    let by_table = policies
        .iter()
        .map(|policy| (policy.table.as_str(), policy))
        .collect::<BTreeMap<_, _>>();
    for policy in policies {
        let mut seen = BTreeSet::new();
        let mut current = policy;
        while let Some(parent) = current.aggregate.parent.as_ref() {
            if !seen.insert(current.table.as_str()) {
                bail!(
                    "storage policy '{}': aggregate parent cycle detected at '{}'",
                    policy.table,
                    current.table
                );
            }
            current = by_table.get(parent.table.as_str()).with_context(|| {
                format!(
                    "storage policy '{}': aggregate parent '{}' has no policy",
                    current.table, parent.table
                )
            })?;
        }
    }
    Ok(())
}

fn validate_c0_ownership(
    policy: &StoragePolicy,
    table_name: &str,
    table: &crate::cold_tier::schema_ir::GeneratedTableSchema,
) -> Result<()> {
    let actual = table.ownership().with_context(|| {
        format!("storage policy '{table_name}': schema fails C0 ownership validation")
    })?;
    match (policy.organization_ownership, actual) {
        (OrganizationOwnership::Direct, GeneratedTableOwnership::Organization) => {
            if policy.organization_column.as_deref() != Some("organization_id") {
                bail!(
                    "storage policy '{table_name}': direct ownership requires organization_column 'organization_id'"
                );
            }
        }
        (OrganizationOwnership::PlatformGlobal, GeneratedTableOwnership::PlatformGlobal(_)) => {
            if policy.organization_column.is_some() {
                bail!(
                    "storage policy '{table_name}': platform-global ownership must not declare organization_column"
                );
            }
            if policy.company_ownership != CompanyOwnership::None {
                bail!(
                    "storage policy '{table_name}': platform-global table must have company_ownership 'none'"
                );
            }
        }
        (declared, actual) => bail!(
            "storage policy '{table_name}': declared organization ownership {:?} disagrees with C0 schema ownership {:?}",
            declared,
            actual
        ),
    }
    Ok(())
}

fn validate_company_path(
    policy: &StoragePolicy,
    table_name: &str,
    table: &crate::cold_tier::schema_ir::GeneratedTableSchema,
    policies: &[StoragePolicy],
    tables: &BTreeMap<&str, &crate::cold_tier::schema_ir::GeneratedTableSchema>,
) -> Result<()> {
    match (
        policy.company_ownership,
        policy.company_column_path.as_deref(),
        policy.company_column_nullable,
    ) {
        (CompanyOwnership::None, None, None) => {
            if table
                .columns
                .iter()
                .any(|column| column.sql_name == "company_id")
            {
                bail!(
                    "storage policy '{table_name}': table has company_id and must declare direct company ownership"
                );
            }
        }
        (CompanyOwnership::None, _, _) => bail!(
            "storage policy '{table_name}': company_ownership 'none' requires null company path and nullability"
        ),
        (CompanyOwnership::Direct, Some(path), Some(nullable))
            if path.len() == 1 && path[0] == "company_id" =>
        {
            ensure_columns_exist(table_name, table, path)?;
            let company_column = table
                .columns
                .iter()
                .find(|column| column.sql_name == "company_id")
                .expect("company column existence checked above");
            if company_column.ty != crate::cold_tier::schema_ir::GeneratedType::U64 {
                bail!("storage policy '{table_name}': company_id must be U64");
            }
            if company_column.nullable != nullable {
                bail!(
                    "storage policy '{table_name}': declared company nullability disagrees with schema"
                );
            }
        }
        (CompanyOwnership::Direct, Some(path), Some(_)) => bail!(
            "storage policy '{table_name}': direct company ownership requires path ['company_id'], found {:?}",
            path
        ),
        (CompanyOwnership::Parent, Some(path), Some(nullable)) if path.len() >= 2 => {
            if table
                .columns
                .iter()
                .any(|column| column.sql_name == "company_id")
            {
                bail!(
                    "storage policy '{table_name}': table has company_id and must use direct company ownership"
                );
            }
            let parent = policy.aggregate.parent.as_ref().with_context(|| {
                format!(
                    "storage policy '{table_name}': parent company ownership requires a child aggregate"
                )
            })?;
            if path[0] != parent.child_column {
                bail!(
                    "storage policy '{table_name}': parent company path must start with '{}'",
                    parent.child_column
                );
            }
            ensure_columns_exist(table_name, table, &path[..1])?;
            let parent_table = tables.get(parent.table.as_str()).with_context(|| {
                format!(
                    "storage policy '{table_name}': company parent table '{}' not found",
                    parent.table
                )
            })?;
            let parent_policy = policies
                .iter()
                .find(|candidate| candidate.table == parent.table)
                .with_context(|| {
                    format!(
                        "storage policy '{table_name}': company parent '{}' has no policy",
                        parent.table
                    )
                })?;
            if parent_policy.company_ownership == CompanyOwnership::None {
                bail!(
                    "storage policy '{table_name}': parent '{}' does not declare company ownership",
                    parent.table
                );
            }
            if parent_policy.company_column_path.as_deref() != Some(&path[1..]) {
                bail!(
                    "storage policy '{table_name}': parent company path disagrees with parent '{}'",
                    parent.table
                );
            }
            if parent_policy.company_column_nullable != Some(nullable) {
                bail!(
                    "storage policy '{table_name}': company nullability disagrees with parent '{}'",
                    parent.table
                );
            }
            if parent_policy.company_ownership == CompanyOwnership::Direct
                && !parent_table
                    .columns
                    .iter()
                    .any(|column| column.sql_name == "company_id")
            {
                bail!(
                    "storage policy '{table_name}': parent '{}' does not have company_id",
                    parent.table
                );
            }
        }
        (CompanyOwnership::Direct | CompanyOwnership::Parent, None, _) => bail!(
            "storage policy '{table_name}': company ownership requires company_column_path and nullability"
        ),
        (CompanyOwnership::Direct | CompanyOwnership::Parent, Some(_), None) => bail!(
            "storage policy '{table_name}': company ownership requires company_column_nullable"
        ),
        (CompanyOwnership::Parent, Some(path), Some(_)) => {
            bail!(
                "storage policy '{table_name}': parent company ownership requires a parent path ending at company_id, found {:?}",
                path
            )
        }
    }
    Ok(())
}

fn validate_primary_key_policy(
    policy: &StoragePolicy,
    table_name: &str,
    table: &crate::cold_tier::schema_ir::GeneratedTableSchema,
) -> Result<()> {
    if policy.primary_key.column != table.primary_key.column_name {
        bail!(
            "storage policy '{table_name}': primary_key.column '{}' does not match schema primary key '{}'",
            policy.primary_key.column,
            table.primary_key.column_name
        );
    }
    match policy.primary_key.strategy {
        PrimaryKeyStrategy::AutoIncrement
            if table.primary_key.ty != crate::cold_tier::schema_ir::GeneratedType::U64 =>
        {
            bail!("storage policy '{table_name}': auto_increment primary key must be U64");
        }
        PrimaryKeyStrategy::Identity
            if table.primary_key.ty != crate::cold_tier::schema_ir::GeneratedType::Identity =>
        {
            bail!("storage policy '{table_name}': identity primary key must use Identity");
        }
        PrimaryKeyStrategy::Composite => {
            bail!(
                "storage policy '{table_name}': schema IR declares one authoritative primary key; composite is invalid"
            );
        }
        _ => {}
    }
    let version_column = match policy.primary_key.version_strategy {
        VersionStrategy::None => None,
        VersionStrategy::UpdatedAt => Some("updated_at"),
        VersionStrategy::ArchiveVersion => Some("archive_version"),
        VersionStrategy::Revision => Some("revision"),
        VersionStrategy::Sequence => Some("sequence"),
    };
    if let Some(version_column) = version_column {
        if !table
            .columns
            .iter()
            .any(|column| column.sql_name == version_column)
        {
            bail!(
                "storage policy '{table_name}': version strategy requires missing column '{version_column}'"
            );
        }
    }
    Ok(())
}

fn ensure_columns_exist(
    table_name: &str,
    table: &crate::cold_tier::schema_ir::GeneratedTableSchema,
    columns: &[String],
) -> Result<()> {
    for column in columns {
        if !table
            .columns
            .iter()
            .any(|candidate| candidate.sql_name == *column)
        {
            bail!(
                "storage policy '{table_name}': company path column '{column}' not found in table"
            );
        }
    }
    Ok(())
}

fn validate_aggregate_and_parent(
    policy: &StoragePolicy,
    table_name: &str,
    table: &crate::cold_tier::schema_ir::GeneratedTableSchema,
    policies: &[StoragePolicy],
    tables: &BTreeMap<&str, &crate::cold_tier::schema_ir::GeneratedTableSchema>,
) -> Result<()> {
    match (policy.aggregate.kind, policy.aggregate.parent.as_ref()) {
        (AggregateKind::Child, Some(parent)) => {
            if parent.table == table_name {
                bail!("storage policy '{table_name}': aggregate parent cannot be itself");
            }
            let parent_table = tables.get(parent.table.as_str()).with_context(|| {
                format!(
                    "storage policy '{table_name}': parent table '{}' not found in schema manifest",
                    parent.table
                )
            })?;
            if !table
                .columns
                .iter()
                .any(|column| column.sql_name == parent.child_column)
            {
                bail!(
                    "storage policy '{table_name}': parent child_column '{}' not found in child table",
                    parent.child_column
                );
            }
            if !parent_table
                .columns
                .iter()
                .any(|column| column.sql_name == parent.parent_column)
            {
                bail!(
                    "storage policy '{table_name}': parent_column '{}' not found in parent table '{}'",
                    parent.parent_column,
                    parent.table
                );
            }
            if parent.parent_column != parent_table.primary_key.column_name {
                bail!(
                    "storage policy '{table_name}': parent_column '{}' must match parent '{}' primary key '{}'",
                    parent.parent_column,
                    parent.table,
                    parent_table.primary_key.column_name
                );
            }
            let child_column = table
                .columns
                .iter()
                .find(|column| column.sql_name == parent.child_column)
                .expect("child column existence checked above");
            if child_column.ty != parent_table.primary_key.ty {
                bail!(
                    "storage policy '{table_name}': child column '{}' type disagrees with parent '{}' primary key",
                    parent.child_column,
                    parent.table
                );
            }
            let parent_policy = policies
                .iter()
                .find(|candidate| candidate.table == parent.table)
                .with_context(|| {
                    format!(
                        "storage policy '{table_name}': parent table '{}' has no storage policy",
                        parent.table
                    )
                })?;
            if parent_policy.organization_ownership != policy.organization_ownership {
                bail!(
                    "storage policy '{table_name}': parent '{}' organization ownership disagrees",
                    parent.table
                );
            }
            if policy.organization_ownership == OrganizationOwnership::Direct
                && parent_policy.organization_column.as_deref() != Some("organization_id")
            {
                bail!(
                    "storage policy '{table_name}': parent '{}' does not carry direct organization_id ownership",
                    parent.table
                );
            }
        }
        (AggregateKind::Child, None) => {
            bail!("storage policy '{table_name}': child aggregate requires parent")
        }
        (AggregateKind::Root | AggregateKind::Standalone, Some(_)) => {
            bail!("storage policy '{table_name}': only child aggregates may declare parent")
        }
        (AggregateKind::Root | AggregateKind::Standalone, None) => {}
    }
    Ok(())
}

fn validate_policy_coherence(policy: &StoragePolicy, table_name: &str) -> Result<()> {
    if policy.cooling_eligibility_source.trim().is_empty() {
        bail!("storage policy '{table_name}': cooling_eligibility_source must not be empty");
    }
    let projection_is_coherent = match policy.projection_mode {
        ProjectionMode::UpsertCurrent => {
            matches!(
                policy.durability_class,
                DurabilityClass::DurableBusinessRecord
                    | DurabilityClass::DurableOperationalState
                    | DurabilityClass::PlatformControl
            ) && policy.delete_behavior == DeleteBehavior::Tombstone
        }
        ProjectionMode::AppendHistory => {
            policy.durability_class == DurabilityClass::DurableHistory
                && policy.delete_behavior == DeleteBehavior::AppendOnly
        }
        ProjectionMode::Snapshot | ProjectionMode::DerivedRebuildable => {
            policy.durability_class == DurabilityClass::DerivedRebuildable
                && policy.delete_behavior == DeleteBehavior::Rebuild
        }
        ProjectionMode::Ephemeral => {
            policy.durability_class == DurabilityClass::Ephemeral
                && policy.delete_behavior == DeleteBehavior::Rebuild
        }
        ProjectionMode::ExternalReference => {
            policy.durability_class == DurabilityClass::ExternalReference
                && policy.delete_behavior == DeleteBehavior::External
                && policy.postgres_access_path == PostgresAccessPath::External
        }
    };
    if !projection_is_coherent {
        bail!(
            "storage policy '{table_name}': projection, durability, and delete behavior are incompatible"
        );
    }
    if policy.durability_class == DurabilityClass::PlatformControl
        && (policy.organization_ownership != OrganizationOwnership::PlatformGlobal
            || policy.postgres_access_path != PostgresAccessPath::PlatformShared)
    {
        bail!(
            "storage policy '{table_name}': platform_control requires platform-global ownership and platform_shared PostgreSQL access"
        );
    }
    if policy.cooling_eligibility == CoolingEligibility::Never
        && policy.hot_retention != HotRetention::Always
    {
        bail!("storage policy '{table_name}': never-cooled tables must use always hot retention");
    }
    if policy.aggregate.kind == AggregateKind::Child
        && policy.dependency_behavior != DependencyBehavior::FollowParent
    {
        bail!("storage policy '{table_name}': child aggregate must follow its parent dependency");
    }
    if policy.aggregate.kind != AggregateKind::Child
        && policy.dependency_behavior == DependencyBehavior::FollowParent
    {
        bail!("storage policy '{table_name}': only child aggregates may follow a parent");
    }
    if policy.hydration_policy == HydrationPolicy::FullRow
        && policy.cooling_eligibility == CoolingEligibility::Never
    {
        bail!("storage policy '{table_name}': full-row hydration requires cooling eligibility");
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StoragePolicyCoverage {
    pub classified: usize,
    pub total: usize,
    pub unclassified: usize,
    pub by_module: BTreeMap<String, usize>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cold_tier::schema_ir::{
        GeneratedColumn, GeneratedIndex, GeneratedPrimaryKey, GeneratedTableSchema, GeneratedType,
    };
    use serde_json::Value;

    fn table(name: &str, platform_global: bool) -> GeneratedTableSchema {
        let mut columns = vec![GeneratedColumn {
            name: "id".into(),
            sql_name: "id".into(),
            ty: GeneratedType::U64,
            nullable: false,
        }];
        if !platform_global {
            columns.extend([
                GeneratedColumn {
                    name: "organization_id".into(),
                    sql_name: "organization_id".into(),
                    ty: GeneratedType::U64,
                    nullable: false,
                },
                GeneratedColumn {
                    name: "company_id".into(),
                    sql_name: "company_id".into(),
                    ty: GeneratedType::U64,
                    nullable: false,
                },
                GeneratedColumn {
                    name: "parent_id".into(),
                    sql_name: "parent_id".into(),
                    ty: GeneratedType::U64,
                    nullable: false,
                },
            ]);
        }
        GeneratedTableSchema {
            rust_name: name.into(),
            sql_name: name.into(),
            primary_key: GeneratedPrimaryKey {
                column_name: "id".into(),
                ty: GeneratedType::U64,
            },
            columns,
            indexes: if platform_global {
                vec![]
            } else {
                vec![GeneratedIndex {
                    name: format!("{name}_organization_id"),
                    columns: vec!["organization_id".into()],
                    unique: false,
                }]
            },
        }
    }

    fn direct_policy(table: &str) -> StoragePolicy {
        StoragePolicy {
            table: table.into(),
            module: "test".into(),
            rationale: "test policy".into(),
            authoritative_resources: (table == "orders")
                .then(|| "orders".into())
                .into_iter()
                .collect(),
            durability_class: DurabilityClass::DurableBusinessRecord,
            organization_ownership: OrganizationOwnership::Direct,
            organization_column: Some("organization_id".into()),
            company_ownership: CompanyOwnership::Direct,
            company_column_path: Some(vec!["company_id".into()]),
            company_column_nullable: Some(false),
            aggregate: AggregateBoundary {
                kind: AggregateKind::Root,
                parent: None,
            },
            primary_key: PrimaryKeyPolicy {
                strategy: PrimaryKeyStrategy::AutoIncrement,
                column: "id".into(),
                version_strategy: VersionStrategy::None,
            },
            projection_mode: ProjectionMode::UpsertCurrent,
            hot_retention: HotRetention::Always,
            cooling_eligibility: CoolingEligibility::Never,
            cooling_eligibility_source: "not eligible until reviewed".into(),
            dependency_behavior: DependencyBehavior::Independent,
            hydration_policy: HydrationPolicy::NotApplicable,
            delete_behavior: DeleteBehavior::Tombstone,
            postgres_access_path: PostgresAccessPath::OrganizationIndex,
            comment: None,
        }
    }

    fn global_policy(table: &str) -> StoragePolicy {
        let mut policy = direct_policy(table);
        policy.module = "platform".into();
        policy.authoritative_resources = vec!["currencies".into()];
        policy.durability_class = DurabilityClass::PlatformControl;
        policy.organization_ownership = OrganizationOwnership::PlatformGlobal;
        policy.organization_column = None;
        policy.company_ownership = CompanyOwnership::None;
        policy.company_column_path = None;
        policy.company_column_nullable = None;
        policy.postgres_access_path = PostgresAccessPath::PlatformShared;
        policy
    }

    fn manifest() -> LumiereSchemaManifest {
        LumiereSchemaManifest {
            version: 1,
            tables: vec![table("orders", false), table("currency", true)],
            enum_types: vec![],
        }
    }

    fn config(policies: Vec<StoragePolicy>) -> StoragePolicyConfig {
        StoragePolicyConfig {
            version: 1,
            policies,
            comment: None,
        }
    }

    fn registry() -> &'static str {
        r#"{"orders":{"table":"orders"},"currencies":{"table":"currency"}}"#
    }

    fn emit_fixture(source: &str, schema: &LumiereSchemaManifest) -> Result<String> {
        emit_storage_policy_manifest_with_expected_count(
            source,
            schema,
            registry(),
            schema.tables.len(),
        )
    }

    #[test]
    fn validates_exact_coverage_and_emits_module_totals() {
        let source = serde_json::to_string(&config(vec![
            direct_policy("orders"),
            global_policy("currency"),
        ]))
        .unwrap();
        let value: Value =
            serde_json::from_str(&emit_fixture(&source, &manifest()).unwrap()).unwrap();
        assert_eq!(value["coverage"]["classified"], 2);
        assert_eq!(value["coverage"]["total"], 2);
        assert_eq!(value["coverage"]["unclassified"], 0);
        assert_eq!(value["coverage"]["by_module"]["test"], 1);
        assert_eq!(value["coverage"]["by_module"]["platform"], 1);
    }

    #[test]
    fn production_emitter_rejects_a_reduced_schema_universe() {
        let source = serde_json::to_string(&config(vec![
            direct_policy("orders"),
            global_policy("currency"),
        ]))
        .unwrap();
        assert!(
            emit_storage_policy_manifest(&source, &manifest(), registry())
                .unwrap_err()
                .to_string()
                .contains("requires 458 schema tables")
        );
    }

    #[test]
    fn rejects_duplicate_and_missing_tables() {
        let m = manifest();
        let duplicate = config(vec![direct_policy("orders"), direct_policy("orders")]);
        assert!(validate_storage_policies(&duplicate, &m)
            .unwrap_err()
            .to_string()
            .contains("duplicate table"));
        let missing = config(vec![direct_policy("orders")]);
        assert!(validate_storage_policies(&missing, &m)
            .unwrap_err()
            .to_string()
            .contains("unclassified"));
    }

    #[test]
    fn rejects_unknown_enum_and_unknown_fields() {
        let unknown_enum = r#"{"version":1,"policies":[{"table":"orders","module":"test","durability_class":"not_real","organization_ownership":"direct","organization_column":"organization_id","company_ownership":"direct","company_column_path":["company_id"],"aggregate":{"kind":"root","parent":null},"primary_key":{"strategy":"auto_increment","column":"id","version_strategy":"none"},"projection_mode":"upsert-current","hot_retention":"always","cooling_eligibility":"never","dependency_behavior":"independent","hydration_policy":"not_applicable","delete_behavior":"tombstone","postgres_access_path":"organization_index"}]}"#;
        assert!(emit_fixture(unknown_enum, &manifest()).is_err());
        let unknown_field = r#"{"version":1,"policies":[],"unexpected":true}"#;
        assert!(emit_fixture(unknown_field, &manifest()).is_err());
    }

    #[test]
    fn rejects_missing_or_misdirected_authoritative_resources() {
        let mut policy = direct_policy("orders");
        policy.authoritative_resources = vec!["missing".into()];
        let source =
            serde_json::to_string(&config(vec![policy, global_policy("currency")])).unwrap();
        assert!(emit_fixture(&source, &manifest())
            .unwrap_err()
            .to_string()
            .contains("does not exist"));

        let mut policy = direct_policy("orders");
        policy.authoritative_resources = vec!["currencies".into()];
        let source =
            serde_json::to_string(&config(vec![policy, global_policy("currency")])).unwrap();
        assert!(emit_fixture(&source, &manifest())
            .unwrap_err()
            .to_string()
            .contains("maps to another table"));
    }

    #[test]
    fn validates_c0_platform_agreement_and_company_path() {
        let mut wrong_global = global_policy("currency");
        wrong_global.organization_ownership = OrganizationOwnership::Direct;
        wrong_global.organization_column = Some("organization_id".into());
        assert!(validate_storage_policies(
            &config(vec![direct_policy("orders"), wrong_global]),
            &manifest()
        )
        .unwrap_err()
        .to_string()
        .contains("disagrees"));

        let mut bad_path = direct_policy("orders");
        bad_path.company_column_path = Some(vec!["missing".into()]);
        assert!(validate_storage_policies(
            &config(vec![bad_path, global_policy("currency")]),
            &manifest()
        )
        .unwrap_err()
        .to_string()
        .contains("direct company ownership"));
    }

    #[test]
    fn validates_parent_columns_and_organization_agreement() {
        let parent = table("orders", false);
        let mut child = table("order_line", false);
        child
            .columns
            .retain(|column| column.sql_name != "company_id");
        let m = LumiereSchemaManifest {
            version: 1,
            tables: vec![parent, child],
            enum_types: vec![],
        };
        let mut parent_policy = direct_policy("orders");
        parent_policy.module = "sales".into();
        let mut child_policy = direct_policy("order_line");
        child_policy.aggregate = AggregateBoundary {
            kind: AggregateKind::Child,
            parent: Some(ParentReference {
                table: "orders".into(),
                child_column: "parent_id".into(),
                parent_column: "id".into(),
            }),
        };
        child_policy.dependency_behavior = DependencyBehavior::FollowParent;
        child_policy.company_ownership = CompanyOwnership::Parent;
        child_policy.company_column_path = Some(vec!["parent_id".into(), "company_id".into()]);
        let valid = validate_storage_policies(
            &config(vec![parent_policy.clone(), child_policy.clone()]),
            &m,
        )
        .unwrap();
        assert_eq!(valid.classified, 2);

        child_policy
            .aggregate
            .parent
            .as_mut()
            .unwrap()
            .parent_column = "missing".into();
        assert!(
            validate_storage_policies(&config(vec![parent_policy, child_policy]), &m)
                .unwrap_err()
                .to_string()
                .contains("parent_column")
        );
    }

    #[test]
    fn rejects_bad_aggregate_shape() {
        let mut root = direct_policy("orders");
        root.aggregate.kind = AggregateKind::Child;
        assert!(validate_storage_policies(
            &config(vec![root, global_policy("currency")]),
            &manifest()
        )
        .unwrap_err()
        .to_string()
        .contains("requires parent"));
    }

    #[test]
    fn rejects_incoherent_lifecycle_combinations() {
        let mut policy = direct_policy("orders");
        policy.durability_class = DurabilityClass::Ephemeral;
        assert!(validate_storage_policies(
            &config(vec![policy, global_policy("currency")]),
            &manifest()
        )
        .unwrap_err()
        .to_string()
        .contains("incompatible"));

        let mut policy = direct_policy("orders");
        policy.dependency_behavior = DependencyBehavior::FollowParent;
        assert!(validate_storage_policies(
            &config(vec![policy, global_policy("currency")]),
            &manifest()
        )
        .unwrap_err()
        .to_string()
        .contains("only child aggregates"));
    }

    #[test]
    fn rejects_parent_company_path_that_does_not_match_the_aggregate() {
        let m = LumiereSchemaManifest {
            version: 1,
            tables: vec![table("orders", false), {
                let mut child = table("order_line", false);
                child
                    .columns
                    .retain(|column| column.sql_name != "company_id");
                child
            }],
            enum_types: vec![],
        };
        let parent = direct_policy("orders");
        let mut child = direct_policy("order_line");
        child.aggregate = AggregateBoundary {
            kind: AggregateKind::Child,
            parent: Some(ParentReference {
                table: "orders".into(),
                child_column: "parent_id".into(),
                parent_column: "id".into(),
            }),
        };
        child.dependency_behavior = DependencyBehavior::FollowParent;
        child.company_ownership = CompanyOwnership::Parent;
        child.company_column_path = Some(vec!["wrong_id".into(), "company_id".into()]);
        assert!(validate_storage_policies(&config(vec![parent, child]), &m)
            .unwrap_err()
            .to_string()
            .contains("parent company path"));
    }

    #[test]
    fn rejects_aggregate_parent_cycles() {
        let m = LumiereSchemaManifest {
            version: 1,
            tables: vec![table("left", false), table("right", false)],
            enum_types: vec![],
        };
        let mut left = direct_policy("left");
        left.aggregate = AggregateBoundary {
            kind: AggregateKind::Child,
            parent: Some(ParentReference {
                table: "right".into(),
                child_column: "parent_id".into(),
                parent_column: "id".into(),
            }),
        };
        left.dependency_behavior = DependencyBehavior::FollowParent;
        let mut right = direct_policy("right");
        right.aggregate = AggregateBoundary {
            kind: AggregateKind::Child,
            parent: Some(ParentReference {
                table: "left".into(),
                child_column: "parent_id".into(),
                parent_column: "id".into(),
            }),
        };
        right.dependency_behavior = DependencyBehavior::FollowParent;
        assert!(validate_storage_policies(&config(vec![left, right]), &m)
            .unwrap_err()
            .to_string()
            .contains("cycle"));
    }
}
