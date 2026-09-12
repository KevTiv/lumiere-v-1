//! Structural query/subscription descriptors shared by the STDB and PG read
//! adapters.
//!
//! This module deliberately contains no SQL.  It turns the Rust-owned
//! resource registry into the metadata needed to construct an authenticated
//! `ResourceReadPlan`; transport adapters remain responsible for rendering
//! that plan in their own dialect.

use crate::paths::Paths;
use crate::support::{read_to_string, write_file};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// The scope a read must resolve before it can be compiled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScopeKind {
    /// A direct organization-owned row.
    Organization,
    /// An organization-owned row additionally restricted to one company.
    OrganizationCompany,
}

/// A descriptor for one structured predicate.  Values are runtime bindings,
/// not SQL fragments or caller-provided column names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PredicateDescriptor {
    pub column: String,
    pub operator: PredicateOperator,
    #[serde(default)]
    pub value: Option<PredicateValue>,
}

/// Operators supported by both read compilers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PredicateOperator {
    Eq,
    IsNull,
    IsNotNull,
    Gte,
    Lte,
    In,
}

/// A safe source for a predicate value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum PredicateValue {
    OrganizationId,
    CompanyId,
    Literal(ScalarValue),
    CursorField(usize),
}

/// Scalar values accepted by the existing STDB/PG read-plan vocabulary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum ScalarValue {
    U64(u64),
    I64(i64),
    Text(String),
    Bool(bool),
}

/// A deterministic order key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrderDescriptor {
    pub column: String,
    pub direction: OrderDirection,
}

/// Direction is intentionally transport-neutral.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderDirection {
    Asc,
    Desc,
}

/// Projection metadata.  The registry's mandatory fields must be included.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectionDescriptor {
    pub fields: Vec<String>,
}

/// Shared physical access-path vocabulary.  It contains no index/macro/SQL
/// syntax and can therefore be consumed by both STDB and PostgreSQL adapters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccessPathDescriptor {
    pub key: String,
    pub columns: Vec<String>,
    pub tenant_prefix: TenantPrefix,
    pub cardinality: Cardinality,
    pub ordered: bool,
    pub generated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TenantPrefix {
    Organization,
    OrganizationCompany,
}

/// Result-size class used by both query and subscription contracts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Cardinality {
    One,
    Few,
    BoundedPage,
    BoundedSet,
    Broad,
}

/// Expected durable partition behavior.  `None` means the resource is hot or
/// has no durable partition contract; it does not mean an unbounded scan is
/// acceptable for an interactive request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PartitionExpectation {
    Single { key: String },
    BoundedRange { key: String },
    MultiPartitionAnalytical,
}

/// Source class shared by ordinary reads and realtime reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceClass {
    CanonicalTable,
    HotProjection,
}

/// Query descriptor emitted for one registry resource.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueryDescriptor {
    pub resource: String,
    pub table: String,
    pub projection: ProjectionDescriptor,
    pub scope: ScopeKind,
    pub predicates: Vec<PredicateDescriptor>,
    pub order_by: Vec<OrderDescriptor>,
    pub cursor_columns: Vec<String>,
    pub default_limit: u32,
    pub access_path: AccessPathDescriptor,
    pub expected_cardinality: Cardinality,
    pub latency_class: LatencyClass,
    pub partition_expectation: Option<PartitionExpectation>,
    pub source_class: SourceClass,
}

/// Subscription descriptor.  `realtime: false` is the fail-closed default
/// until a resource has an explicit realtime census entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubscriptionDescriptor {
    pub resource: String,
    pub table: String,
    pub projection: ProjectionDescriptor,
    pub scope: ScopeKind,
    pub predicates: Vec<PredicateDescriptor>,
    pub order_by: Vec<OrderDescriptor>,
    pub realtime: bool,
    pub delivery: SubscriptionDelivery,
    pub access_path: AccessPathDescriptor,
    pub expected_cardinality: Cardinality,
    pub latency_class: LatencyClass,
    pub update_fanout: UpdateFanout,
    pub source_class: SourceClass,
    pub reconnect_class: ReconnectClass,
}

/// Cold-capable subscriptions invalidate the merged query; they never claim
/// that the STDB tail is a complete row set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SubscriptionDelivery {
    Rows,
    Invalidation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LatencyClass {
    Interactive,
    Background,
    Analytical,
    Presence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateFanout {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReconnectClass {
    Eager,
    Staggered,
    OnDemand,
}

/// The generated handoff consumed by future query and realtime adapters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReadDescriptorManifest {
    pub schema_version: u32,
    pub queries: Vec<QueryDescriptor>,
    pub subscriptions: Vec<SubscriptionDescriptor>,
}

/// Runtime values resolved from the authenticated request/session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadContext {
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub cursor: Option<String>,
    pub limit: u32,
}

/// Structural equivalent of `api_server::cold_tier::ResourceReadPlan`.
/// Keeping this type in codegen avoids importing runtime crates into the
/// generator while preserving the exact read-plan fields and semantics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompiledResourceReadPlan {
    pub resource: String,
    pub table: String,
    pub projection: Vec<String>,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub predicates: Vec<PredicateDescriptor>,
    pub order_by: Vec<OrderDescriptor>,
    pub cursor_columns: Vec<String>,
    pub cursor: Option<String>,
    pub limit: u32,
    pub access_path: AccessPathDescriptor,
    pub partition_expectation: Option<PartitionExpectation>,
}

impl QueryDescriptor {
    /// Validate the descriptor and resolve only authenticated runtime values.
    pub fn compile(&self, context: ReadContext) -> Result<CompiledResourceReadPlan> {
        self.validate()?;
        if context.organization_id == 0 {
            bail!(
                "resource {} requires positive organization scope",
                self.resource
            );
        }
        if self.scope == ScopeKind::OrganizationCompany && context.company_id.is_none() {
            bail!("resource {} requires company scope", self.resource);
        }
        if context.company_id == Some(0) {
            bail!("resource {} requires positive company scope", self.resource);
        }
        if context.limit == 0 {
            bail!("resource {} read limit must be positive", self.resource);
        }
        if context.limit > self.default_limit {
            bail!(
                "resource {} read limit {} exceeds generated maximum {}",
                self.resource,
                context.limit,
                self.default_limit
            );
        }
        Ok(CompiledResourceReadPlan {
            resource: self.resource.clone(),
            table: self.table.clone(),
            projection: self.projection.fields.clone(),
            organization_id: context.organization_id,
            company_id: context.company_id,
            predicates: self.predicates.clone(),
            order_by: self.order_by.clone(),
            cursor_columns: self.cursor_columns.clone(),
            cursor: context.cursor,
            limit: context.limit,
            access_path: self.access_path.clone(),
            partition_expectation: self.partition_expectation.clone(),
        })
    }

    /// Validate the static shape before a transport adapter renders it.
    pub fn validate(&self) -> Result<()> {
        validate_common(
            &self.resource,
            &self.table,
            &self.projection,
            self.scope,
            &self.predicates,
            &self.order_by,
            Some(&self.cursor_columns),
            &self.access_path,
            self.expected_cardinality,
            self.latency_class,
            self.partition_expectation.as_ref(),
            self.source_class,
        )?;
        if self.default_limit == 0 {
            bail!("resource {} has zero default limit", self.resource);
        }
        Ok(())
    }
}

impl SubscriptionDescriptor {
    /// Validate that an enabled realtime contract has a bounded tenant path.
    pub fn validate(&self) -> Result<()> {
        validate_common(
            &self.resource,
            &self.table,
            &self.projection,
            self.scope,
            &self.predicates,
            &self.order_by,
            None,
            &self.access_path,
            self.expected_cardinality,
            self.latency_class,
            None,
            self.source_class,
        )?;
        if self.realtime && self.expected_cardinality == Cardinality::Broad {
            bail!(
                "resource {} cannot enable realtime with broad cardinality",
                self.resource
            );
        }
        if self.realtime && self.delivery == SubscriptionDelivery::Rows {
            bail!(
                "archive-capable resource {} must use invalidation delivery",
                self.resource
            );
        }
        if self.realtime && self.latency_class == LatencyClass::Interactive {
            if self.scope == ScopeKind::Organization
                && self.access_path.tenant_prefix != TenantPrefix::Organization
            {
                bail!(
                    "resource {} has an incompatible organization access path",
                    self.resource
                );
            }
            if self.scope == ScopeKind::OrganizationCompany
                && self.access_path.tenant_prefix != TenantPrefix::OrganizationCompany
            {
                bail!(
                    "resource {} has an incompatible organization/company access path",
                    self.resource
                );
            }
        }
        Ok(())
    }
}

/// Query/subscription parity is checked before either adapter is allowed to
/// compile transport syntax.
pub fn validate_parity(
    query: &QueryDescriptor,
    subscription: &SubscriptionDescriptor,
) -> Result<()> {
    query.validate()?;
    subscription.validate()?;
    if query.resource != subscription.resource
        || query.table != subscription.table
        || query.projection != subscription.projection
        || query.scope != subscription.scope
        || query.predicates != subscription.predicates
        || query.order_by != subscription.order_by
        || query.access_path != subscription.access_path
        || query.source_class != subscription.source_class
    {
        bail!(
            "resource {} query/subscription descriptor drift",
            query.resource
        );
    }
    Ok(())
}

fn validate_common(
    resource: &str,
    table: &str,
    projection: &ProjectionDescriptor,
    scope: ScopeKind,
    predicates: &[PredicateDescriptor],
    order_by: &[OrderDescriptor],
    cursor_columns: Option<&[String]>,
    access_path: &AccessPathDescriptor,
    expected_cardinality: Cardinality,
    latency_class: LatencyClass,
    partition_expectation: Option<&PartitionExpectation>,
    source_class: SourceClass,
) -> Result<()> {
    if resource.is_empty() || table.is_empty() {
        bail!("resource and table names must not be empty");
    }
    if projection.fields.is_empty() {
        bail!("resource {resource} has an empty projection");
    }
    let mut fields = BTreeSet::new();
    if projection
        .fields
        .iter()
        .any(|field| field.is_empty() || !fields.insert(field))
    {
        bail!("resource {resource} has an invalid or duplicate projection field");
    }
    let has_field = |name: &str| projection.fields.iter().any(|field| field == name);
    if !has_field("id") || !has_field("organization_id") {
        bail!("resource {resource} projection lacks mandatory identity scope");
    }
    if scope == ScopeKind::OrganizationCompany && !has_field("company_id") {
        bail!("resource {resource} projection lacks mandatory company scope");
    }
    if order_by.is_empty() {
        bail!("resource {resource} has no deterministic order");
    }
    if let Some(cursor_columns) = cursor_columns {
        if cursor_columns.is_empty() || cursor_columns.last().map(String::as_str) != Some("id") {
            bail!("resource {resource} must use id as the keyset tie-breaker");
        }
        if cursor_columns.len() != order_by.len()
            || cursor_columns
                .iter()
                .zip(order_by)
                .any(|(cursor, order)| cursor != &order.column)
        {
            bail!("resource {resource} cursor columns do not match order");
        }
    }
    if access_path.columns.is_empty() || access_path.key.is_empty() {
        bail!("resource {resource} has an incomplete access path");
    }
    if scope == ScopeKind::Organization && access_path.tenant_prefix != TenantPrefix::Organization {
        bail!("resource {resource} requires an organization-leading access path");
    }
    if scope == ScopeKind::OrganizationCompany
        && access_path.tenant_prefix != TenantPrefix::OrganizationCompany
    {
        bail!("resource {resource} requires an organization/company-leading access path");
    }
    if expected_cardinality == Cardinality::Broad && latency_class == LatencyClass::Interactive {
        bail!("resource {resource} cannot be interactive and broad");
    }
    if source_class == SourceClass::HotProjection && access_path.generated == false {
        bail!("resource {resource} projection source requires generated access metadata");
    }
    if matches!(
        partition_expectation,
        Some(PartitionExpectation::Single { .. })
    ) && access_path.tenant_prefix == TenantPrefix::OrganizationCompany
        && !predicates.iter().any(|predicate| {
            predicate.column == "company_id" && predicate.operator == PredicateOperator::Eq
        })
    {
        bail!("resource {resource} single-partition company reads need a company predicate");
    }
    Ok(())
}

/// Generate descriptors from the reviewed archive-read policy, storage policy,
/// and durable codec. Only archive-capable resources can enter this manifest;
/// ordinary resource convergence remains a separate application-contract gate.
pub fn emit_descriptor_manifest(
    descriptor_policy_json: &str,
    storage_policy_json: &str,
    codec_manifest_json: &str,
) -> Result<String> {
    let descriptor_policy: DescriptorPolicyRoot = serde_json::from_str(descriptor_policy_json)
        .context("parse read-descriptor-policies.json")?;
    if descriptor_policy.version != 1 {
        bail!("read descriptor policy version must be 1");
    }
    let policies: StoragePolicyRoot =
        serde_json::from_str(storage_policy_json).context("parse storage-policy-manifest.json")?;
    let codecs: CodecManifest =
        serde_json::from_str(codec_manifest_json).context("parse codec-manifest.json")?;
    let policy_by_table = policies
        .policies
        .into_iter()
        .map(|policy| (policy.table.clone(), policy))
        .collect::<BTreeMap<_, _>>();

    let mut queries = Vec::new();
    let mut subscriptions = Vec::new();
    for descriptor in descriptor_policy.descriptors {
        let policy = policy_by_table.get(&descriptor.table).with_context(|| {
            format!(
                "read descriptor {} has no storage policy",
                descriptor.resource
            )
        })?;
        if policy.archive.is_none() {
            bail!(
                "read descriptor {} targets non-archive table {}",
                descriptor.resource,
                descriptor.table
            );
        }
        let resource = descriptor.resource;
        let scope = if policy.company_ownership == "direct" {
            ScopeKind::OrganizationCompany
        } else {
            ScopeKind::Organization
        };
        let source_class = SourceClass::CanonicalTable;
        let tenant_prefix = if scope == ScopeKind::OrganizationCompany {
            TenantPrefix::OrganizationCompany
        } else {
            TenantPrefix::Organization
        };
        let access_path_name = policy.postgres_access_path.as_str();
        let mut access_path_columns = if scope == ScopeKind::OrganizationCompany {
            vec!["organization_id".into(), "company_id".into()]
        } else {
            vec!["organization_id".into()]
        };
        for order in &descriptor.order_by {
            if !access_path_columns
                .iter()
                .any(|column| column == &order.column)
            {
                access_path_columns.push(order.column.clone());
            }
        }
        let access_path = AccessPathDescriptor {
            key: format!("{}.{}", descriptor.table, access_path_name),
            columns: access_path_columns,
            tenant_prefix,
            cardinality: Cardinality::BoundedPage,
            ordered: true,
            generated: true,
        };
        let codec = codecs.tables.get(&policy.table).with_context(|| {
            format!(
                "archive-capable table {} has no generated codec",
                policy.table
            )
        })?;
        let projection = ProjectionDescriptor {
            fields: codec
                .columns
                .iter()
                .map(|column| column.name.clone())
                .collect(),
        };
        let predicates = if scope == ScopeKind::OrganizationCompany {
            vec![PredicateDescriptor {
                column: "company_id".into(),
                operator: PredicateOperator::Eq,
                value: Some(PredicateValue::CompanyId),
            }]
        } else {
            Vec::new()
        };
        let order_by = descriptor
            .order_by
            .iter()
            .map(|order| {
                Ok(OrderDescriptor {
                    column: order.column.clone(),
                    direction: match order.direction.as_str() {
                        "asc" => OrderDirection::Asc,
                        "desc" => OrderDirection::Desc,
                        other => {
                            return Err(anyhow::anyhow!(
                                "archive-capable table {} has unsupported order direction {other}",
                                policy.table
                            ))
                        }
                    },
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let cursor_columns = order_by
            .iter()
            .map(|order| order.column.clone())
            .collect::<Vec<_>>();
        let partition_expectation = match access_path_name {
            "organization_partition" => Some(PartitionExpectation::Single {
                key: "organization_id".into(),
            }),
            _ => None,
        };
        let query = QueryDescriptor {
            resource: resource.clone(),
            table: descriptor.table.clone(),
            projection: projection.clone(),
            scope,
            predicates: predicates.clone(),
            order_by: order_by.clone(),
            cursor_columns,
            default_limit: descriptor.max_limit,
            access_path: access_path.clone(),
            expected_cardinality: Cardinality::BoundedPage,
            latency_class: LatencyClass::Interactive,
            partition_expectation: partition_expectation.clone(),
            source_class,
        };
        query.validate()?;
        let subscription = SubscriptionDescriptor {
            resource,
            table: descriptor.table,
            projection,
            scope,
            predicates,
            order_by,
            realtime: true,
            delivery: SubscriptionDelivery::Invalidation,
            access_path,
            expected_cardinality: Cardinality::BoundedSet,
            latency_class: LatencyClass::Interactive,
            update_fanout: UpdateFanout::Medium,
            source_class,
            reconnect_class: ReconnectClass::OnDemand,
        };
        subscription.validate()?;
        queries.push(query);
        subscriptions.push(subscription);
    }
    let manifest = ReadDescriptorManifest {
        schema_version: 1,
        queries,
        subscriptions,
    };
    Ok(serde_json::to_string_pretty(&manifest)? + "\n")
}

/// Emit the generated artifact into the contracts staging tree.
pub fn run(paths: &Paths) -> Result<()> {
    let descriptor_policy = read_to_string(&paths.read_descriptor_policy_json)?;
    let storage_policy = read_to_string(&paths.storage_policy_json)?;
    let codec_manifest = read_to_string(&paths.codec_manifest_out)?;
    let output = emit_descriptor_manifest(&descriptor_policy, &storage_policy, &codec_manifest)?;
    validate_postgres_access_paths(&output, &storage_policy, &paths.cold_ddl_dir)?;
    write_file(&paths.read_descriptor_manifest_out, &output)?;
    println!("Wrote {}", paths.read_descriptor_manifest_out.display());
    Ok(())
}

fn validate_postgres_access_paths(
    descriptor_manifest_json: &str,
    storage_policy_json: &str,
    cold_ddl_dir: &Path,
) -> Result<()> {
    let descriptors: ReadDescriptorManifest = serde_json::from_str(descriptor_manifest_json)
        .context("parse generated read descriptor manifest")?;
    let policies: Value =
        serde_json::from_str(storage_policy_json).context("parse storage policy for read paths")?;
    let policy_rows = policies["policies"]
        .as_array()
        .context("storage policy lacks policies")?;
    for query in descriptors.queries {
        let policy = policy_rows
            .iter()
            .find(|policy| policy["table"].as_str() == Some(query.table.as_str()))
            .with_context(|| format!("query {} has no storage policy", query.resource))?;
        let cold_table = policy["archive"]["cold_table"]
            .as_str()
            .with_context(|| format!("query {} has no cold table", query.resource))?;
        let ddl_path = cold_ddl_dir.join(format!("{cold_table}.sql"));
        let ddl = read_to_string(&ddl_path)?;
        let expected = expected_postgres_index_ddl(cold_table, &query.access_path.columns);
        if !ddl.contains(&expected) {
            bail!(
                "query {} requires PostgreSQL access path {:?}, absent from {}",
                query.resource,
                query.access_path.columns,
                ddl_path.display()
            );
        }
    }
    Ok(())
}

fn expected_postgres_index_ddl(cold_table: &str, columns: &[String]) -> String {
    format!(
        "CREATE INDEX IF NOT EXISTS {cold_table}_read_path ON {cold_table} ({});",
        columns.join(", ")
    )
}

#[derive(Debug, Deserialize)]
struct DescriptorPolicyRoot {
    version: u32,
    descriptors: Vec<DescriptorPolicy>,
}

#[derive(Debug, Deserialize)]
struct DescriptorPolicy {
    resource: String,
    table: String,
    max_limit: u32,
    order_by: Vec<DescriptorOrder>,
}

#[derive(Debug, Deserialize)]
struct DescriptorOrder {
    column: String,
    direction: String,
}

#[derive(Debug, Deserialize)]
struct StoragePolicyRoot {
    policies: Vec<StoragePolicy>,
}

#[derive(Debug, Deserialize)]
struct StoragePolicy {
    table: String,
    company_ownership: String,
    postgres_access_path: String,
    archive: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct CodecManifest {
    tables: BTreeMap<String, CodecTable>,
}

#[derive(Debug, Deserialize)]
struct CodecTable {
    columns: Vec<CodecColumn>,
}

#[derive(Debug, Deserialize)]
struct CodecColumn {
    name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query() -> QueryDescriptor {
        QueryDescriptor {
            resource: "sale-orders".into(),
            table: "sale_order".into(),
            projection: ProjectionDescriptor {
                fields: vec!["id".into(), "organization_id".into()],
            },
            scope: ScopeKind::Organization,
            predicates: vec![],
            order_by: vec![OrderDescriptor {
                column: "id".into(),
                direction: OrderDirection::Asc,
            }],
            cursor_columns: vec!["id".into()],
            default_limit: 100,
            access_path: AccessPathDescriptor {
                key: "sale_order.organization_index".into(),
                columns: vec!["organization_id".into(), "id".into()],
                tenant_prefix: TenantPrefix::Organization,
                cardinality: Cardinality::BoundedPage,
                ordered: true,
                generated: true,
            },
            expected_cardinality: Cardinality::BoundedPage,
            latency_class: LatencyClass::Interactive,
            partition_expectation: None,
            source_class: SourceClass::CanonicalTable,
        }
    }

    #[test]
    fn compiles_authenticated_context_into_resource_read_plan_shape() {
        let plan = query()
            .compile(ReadContext {
                organization_id: 7,
                company_id: None,
                cursor: Some("id:10".into()),
                limit: 25,
            })
            .unwrap();
        assert_eq!(plan.resource, "sale-orders");
        assert_eq!(plan.organization_id, 7);
        assert_eq!(plan.cursor_columns, vec!["id"]);
        assert_eq!(plan.cursor.as_deref(), Some("id:10"));
    }

    #[test]
    fn postgres_index_ddl_uses_generated_tenant_and_keyset_columns() {
        let query = query();
        assert_eq!(
            expected_postgres_index_ddl("cold_sale_order", &query.access_path.columns),
            "CREATE INDEX IF NOT EXISTS cold_sale_order_read_path ON cold_sale_order (organization_id, id);"
        );
    }

    #[test]
    fn rejects_cursor_without_deterministic_tie_breaker() {
        let mut descriptor = query();
        descriptor.cursor_columns = vec!["created_at".into()];
        descriptor.order_by[0].column = "created_at".into();
        assert!(descriptor.validate().is_err());
    }

    #[test]
    fn rejects_missing_company_context() {
        let mut descriptor = query();
        descriptor.scope = ScopeKind::OrganizationCompany;
        descriptor.access_path.tenant_prefix = TenantPrefix::OrganizationCompany;
        descriptor.predicates = vec![PredicateDescriptor {
            column: "company_id".into(),
            operator: PredicateOperator::Eq,
            value: Some(PredicateValue::CompanyId),
        }];
        assert!(descriptor
            .compile(ReadContext {
                organization_id: 7,
                company_id: None,
                cursor: None,
                limit: 25,
            })
            .is_err());
        assert!(descriptor
            .compile(ReadContext {
                organization_id: 7,
                company_id: Some(0),
                cursor: None,
                limit: 25,
            })
            .is_err());
    }

    #[test]
    fn parity_rejects_scope_or_projection_drift() {
        let query = query();
        let subscription = SubscriptionDescriptor {
            resource: query.resource.clone(),
            table: query.table.clone(),
            projection: ProjectionDescriptor {
                fields: vec!["id".into()],
            },
            scope: query.scope,
            predicates: query.predicates.clone(),
            order_by: query.order_by.clone(),
            realtime: false,
            delivery: SubscriptionDelivery::Invalidation,
            access_path: query.access_path.clone(),
            expected_cardinality: Cardinality::BoundedSet,
            latency_class: LatencyClass::Interactive,
            update_fanout: UpdateFanout::Low,
            source_class: query.source_class,
            reconnect_class: ReconnectClass::OnDemand,
        };
        assert!(validate_parity(&query, &subscription).is_err());
    }

    #[test]
    fn generated_archive_manifest_is_structural_and_invalidation_only() {
        let descriptors = r#"{
          "version": 1,
          "descriptors": [{"resource":"pos-orders","table":"pos_order","max_limit":500,"order_by":[{"column":"id","direction":"desc"}]}]
        }"#;
        let policy = r#"{
          "policies": [
            {"table":"pos_order","company_ownership":"direct","postgres_access_path":"organization_partition","archive":{"order_by":[{"column":"id","direction":"DESC"}]}},
            {"table":"account_asset","company_ownership":"direct","postgres_access_path":"organization_index","archive":null}
          ]
        }"#;
        let codec = r#"{"tables":{"pos_order":{"columns":[{"name":"id"},{"name":"organization_id"},{"name":"company_id"}]}}}"#;
        let manifest: ReadDescriptorManifest =
            serde_json::from_str(&emit_descriptor_manifest(descriptors, policy, codec).unwrap())
                .unwrap();
        assert_eq!(manifest.queries.len(), 1);
        assert_eq!(
            manifest.queries[0].order_by[0].direction,
            OrderDirection::Desc
        );
        assert!(manifest.queries[0]
            .projection
            .fields
            .iter()
            .any(|field| field == "company_id"));
        assert!(manifest
            .subscriptions
            .iter()
            .all(|descriptor| descriptor.realtime
                && descriptor.delivery == SubscriptionDelivery::Invalidation));
        assert_eq!(
            manifest
                .queries
                .iter()
                .find(|query| query.resource == "pos-orders")
                .unwrap()
                .scope,
            ScopeKind::OrganizationCompany
        );
    }
}
