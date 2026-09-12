//! Runtime compiler for generated cold-tier query and subscription descriptors.

use std::sync::OnceLock;

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;

use super::{pg_codec, OrderDirection, PageSpec, ReadOrder, ResourceReadPlan};

const MANIFEST_JSON: &str = lumiere_contracts::manifests::READ_PLAN_DESCRIPTORS;
const SUPPORTED_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadDescriptorManifest {
    schema_version: u32,
    queries: Vec<QueryDescriptor>,
    subscriptions: Vec<SubscriptionDescriptor>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct QueryDescriptor {
    resource: String,
    table: String,
    projection: ProjectionDescriptor,
    scope: ScopeKind,
    predicates: Vec<PredicateDescriptor>,
    order_by: Vec<OrderDescriptor>,
    cursor_columns: Vec<String>,
    default_limit: u32,
    access_path: AccessPathDescriptor,
    expected_cardinality: String,
    latency_class: String,
    partition_expectation: PartitionExpectation,
    source_class: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SubscriptionDescriptor {
    resource: String,
    table: String,
    projection: ProjectionDescriptor,
    scope: ScopeKind,
    predicates: Vec<PredicateDescriptor>,
    order_by: Vec<OrderDescriptor>,
    realtime: bool,
    delivery: String,
    access_path: AccessPathDescriptor,
    expected_cardinality: String,
    latency_class: String,
    update_fanout: String,
    source_class: String,
    reconnect_class: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct ProjectionDescriptor {
    fields: Vec<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ScopeKind {
    Organization,
    OrganizationCompany,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct PredicateDescriptor {
    column: String,
    operator: String,
    value: Option<PredicateValue>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
enum PredicateValue {
    OrganizationId,
    CompanyId,
    Literal(serde_json::Value),
    CursorField(usize),
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct OrderDescriptor {
    column: String,
    direction: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct AccessPathDescriptor {
    key: String,
    columns: Vec<String>,
    tenant_prefix: String,
    cardinality: String,
    ordered: bool,
    generated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum PartitionExpectation {
    Single { key: String },
    BoundedRange { key: String },
    MultiPartitionAnalytical,
}

static MANIFEST: OnceLock<Result<ReadDescriptorManifest, String>> = OnceLock::new();

fn manifest() -> Result<&'static ReadDescriptorManifest> {
    MANIFEST
        .get_or_init(|| {
            serde_json::from_str(MANIFEST_JSON)
                .map_err(|error| format!("parse generated read descriptors: {error}"))
        })
        .as_ref()
        .map_err(|error| anyhow!(error.clone()))
        .and_then(|manifest| {
            if manifest.schema_version != SUPPORTED_SCHEMA_VERSION {
                bail!(
                    "unsupported read descriptor schema version {}",
                    manifest.schema_version
                );
            }
            Ok(manifest)
        })
}

/// Compile the generated query descriptor using authenticated runtime scope.
pub fn compile_query_plan(
    resource: &str,
    organization_id: u64,
    company_id: Option<u64>,
    cursor: Option<String>,
    limit: Option<u32>,
    columns: &[pg_codec::ColumnCodec],
) -> Result<ResourceReadPlan> {
    let manifest = manifest()?;
    let descriptor = unique_query(manifest, resource)?;
    validate_query(descriptor, columns)?;
    validate_scope(descriptor.scope, organization_id, company_id)?;

    let limit = limit.unwrap_or(descriptor.default_limit);
    if limit == 0 || limit > descriptor.default_limit {
        bail!(
            "resource {resource} limit {limit} exceeds generated maximum {}",
            descriptor.default_limit
        );
    }

    Ok(ResourceReadPlan {
        resource: descriptor.resource.clone(),
        table: descriptor.table.clone(),
        projection: pg_codec::projection_with_pg_casts(columns),
        organization_id,
        company_id,
        predicates: Vec::new(),
        order: compile_order(&descriptor.order_by)?,
        page: PageSpec { limit, cursor },
    })
}

/// List the generated realtime resource keys accepted by the websocket API.
pub fn subscription_resource_keys() -> Result<Vec<String>> {
    let manifest = manifest()?;
    let mut resources = manifest
        .subscriptions
        .iter()
        .filter(|descriptor| descriptor.realtime)
        .map(|descriptor| descriptor.resource.clone())
        .collect::<Vec<_>>();
    resources.sort();
    resources.dedup();
    Ok(resources)
}

/// Compile one generated invalidation subscription with server-resolved scope.
pub fn compile_subscription_sql(
    resource: &str,
    organization_id: u64,
    company_id: Option<u64>,
) -> Result<String> {
    let manifest = manifest()?;
    let query = unique_query(manifest, resource)?;
    let subscription = unique_subscription(manifest, resource)?;
    validate_subscription(query, subscription)?;
    validate_scope(subscription.scope, organization_id, company_id)?;

    let mut sql = format!(
        "SELECT * FROM {} WHERE organization_id = {organization_id}",
        subscription.table
    );
    if subscription.scope == ScopeKind::OrganizationCompany {
        let company_id = company_id.context("generated subscription requires company scope")?;
        sql.push_str(&format!(" AND company_id = {company_id}"));
    }
    Ok(sql)
}

fn unique_query<'a>(
    manifest: &'a ReadDescriptorManifest,
    resource: &str,
) -> Result<&'a QueryDescriptor> {
    let mut matches = manifest
        .queries
        .iter()
        .filter(|descriptor| descriptor.resource == resource);
    let descriptor = matches
        .next()
        .with_context(|| format!("no generated query descriptor for {resource}"))?;
    if matches.next().is_some() {
        bail!("duplicate generated query descriptor for {resource}");
    }
    Ok(descriptor)
}

fn unique_subscription<'a>(
    manifest: &'a ReadDescriptorManifest,
    resource: &str,
) -> Result<&'a SubscriptionDescriptor> {
    let mut matches = manifest
        .subscriptions
        .iter()
        .filter(|descriptor| descriptor.resource == resource);
    let descriptor = matches
        .next()
        .with_context(|| format!("no generated subscription descriptor for {resource}"))?;
    if matches.next().is_some() {
        bail!("duplicate generated subscription descriptor for {resource}");
    }
    Ok(descriptor)
}

fn validate_query(descriptor: &QueryDescriptor, columns: &[pg_codec::ColumnCodec]) -> Result<()> {
    let generated_columns = columns
        .iter()
        .map(|column| column.name.as_str())
        .collect::<Vec<_>>();
    let descriptor_columns = descriptor
        .projection
        .fields
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    if descriptor_columns != generated_columns {
        bail!("generated query projection does not match the durable codec");
    }
    validate_common(
        &descriptor.resource,
        &descriptor.table,
        descriptor.scope,
        &descriptor.predicates,
        &descriptor.order_by,
        &descriptor.access_path,
        &descriptor.expected_cardinality,
        &descriptor.latency_class,
        &descriptor.source_class,
    )?;
    if descriptor.cursor_columns != ["id"] {
        bail!("generated query cursor must use id");
    }
    match &descriptor.partition_expectation {
        PartitionExpectation::Single { key } if key == "organization_id" => {}
        PartitionExpectation::BoundedRange { key } => {
            bail!("unexpected bounded-range partition key {key}")
        }
        PartitionExpectation::Single { key } => bail!("unexpected partition key {key}"),
        PartitionExpectation::MultiPartitionAnalytical => {
            bail!("interactive cold reads cannot span all partitions")
        }
    }
    Ok(())
}

fn validate_subscription(
    query: &QueryDescriptor,
    subscription: &SubscriptionDescriptor,
) -> Result<()> {
    validate_common(
        &subscription.resource,
        &subscription.table,
        subscription.scope,
        &subscription.predicates,
        &subscription.order_by,
        &subscription.access_path,
        &subscription.expected_cardinality,
        &subscription.latency_class,
        &subscription.source_class,
    )?;
    if !subscription.realtime
        || subscription.delivery != "invalidation"
        || subscription.update_fanout.is_empty()
        || subscription.reconnect_class.is_empty()
    {
        bail!("generated cold subscription is not a complete invalidation contract");
    }
    if query.resource != subscription.resource
        || query.table != subscription.table
        || query.projection != subscription.projection
        || query.scope != subscription.scope
        || query.predicates != subscription.predicates
        || query.order_by != subscription.order_by
        || query.access_path != subscription.access_path
        || query.source_class != subscription.source_class
    {
        bail!("generated query/subscription descriptors are not equivalent");
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_common(
    resource: &str,
    table: &str,
    scope: ScopeKind,
    predicates: &[PredicateDescriptor],
    order_by: &[OrderDescriptor],
    access_path: &AccessPathDescriptor,
    cardinality: &str,
    latency_class: &str,
    source_class: &str,
) -> Result<()> {
    if resource != "pos-orders" || table != "pos_order" {
        bail!("unsupported generated cold resource mapping");
    }
    if scope != ScopeKind::OrganizationCompany
        || predicates
            != [PredicateDescriptor {
                column: "company_id".into(),
                operator: "eq".into(),
                value: Some(PredicateValue::CompanyId),
            }]
    {
        bail!("generated cold resource has unsafe scope predicates");
    }
    if order_by
        != [OrderDescriptor {
            column: "id".into(),
            direction: "desc".into(),
        }]
        || access_path.columns != ["organization_id", "company_id", "id"]
        || access_path.tenant_prefix != "organization_company"
        || access_path.key != "pos_order.organization_partition"
        || access_path.cardinality != "bounded-page"
        || !access_path.ordered
        || !access_path.generated
        || cardinality.is_empty()
        || latency_class != "interactive"
        || source_class != "canonical-table"
    {
        bail!("generated cold resource has unsafe access metadata");
    }
    Ok(())
}

fn validate_scope(scope: ScopeKind, organization_id: u64, company_id: Option<u64>) -> Result<()> {
    if organization_id == 0 {
        bail!("generated read requires positive organization scope");
    }
    if scope == ScopeKind::OrganizationCompany && company_id.is_none() {
        bail!("generated read requires company scope");
    }
    if company_id == Some(0) {
        bail!("generated read requires positive company scope");
    }
    Ok(())
}

fn compile_order(order_by: &[OrderDescriptor]) -> Result<Vec<ReadOrder>> {
    order_by
        .iter()
        .map(|order| {
            let direction = match order.direction.as_str() {
                "asc" => OrderDirection::Asc,
                "desc" => OrderDirection::Desc,
                other => bail!("unsupported generated order direction {other}"),
            };
            Ok(ReadOrder {
                column: order.column.clone(),
                direction,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_query_compiles_authenticated_scope() {
        let columns =
            pg_codec::load_columns(lumiere_contracts::manifests::CODEC_MANIFEST, "pos_order")
                .unwrap();
        let plan = compile_query_plan("pos-orders", 42, Some(7), None, Some(100), &columns)
            .expect("generated descriptor should compile");
        assert_eq!(plan.organization_id, 42);
        assert_eq!(plan.company_id, Some(7));
        assert_eq!(plan.table, "pos_order");
        assert_eq!(plan.page.limit, 100);
    }

    #[test]
    fn generated_subscription_is_scoped_invalidation() {
        assert_eq!(subscription_resource_keys().unwrap(), ["pos-orders"]);
        assert_eq!(
            compile_subscription_sql("pos-orders", 42, Some(7)).unwrap(),
            "SELECT * FROM pos_order WHERE organization_id = 42 AND company_id = 7"
        );
        assert!(compile_subscription_sql("pos-orders", 42, None).is_err());
    }
}
