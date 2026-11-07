//! Shared, source-authorized readers for the alpha history surfaces.
//!
//! The closed catalog uses the existing registry or a dedicated source owner.
//! Current readers retain their company, parent and record policies.

use super::*;
use crate::query_exec::execute_resource_query_for_company;
use std::collections::VecDeque;
use stdb_auth::{has_resource_field_read_permission, registry_get, resource_read_denied};

#[derive(Clone, Copy, Debug)]
pub(super) struct RecordAdapter {
    pub table: &'static str,
    pub resource: &'static str,
    pub module: &'static str,
}

// Query owners, rather than URL-derived table names, define this boundary.
// Worklist aliases use their source; dedicated supporting owners appear below.
const MODULE_RESOURCES: &[(&str, &[&str])] = &[
    (
        "accounting",
        &[
            "account-moves",
            "account-move-lines",
            "account-payments",
            "account-accounts",
            "account-journals",
            "account-periods",
            "account-assets",
            "payment-transactions",
            "payment-accounts",
            "payment-fees",
            "payment-reconciliations",
            "payment-reversals",
            "bank-statements",
            "bank-statement-lines",
            "budgets",
            "budget-lines",
            "analytic-accounts",
            "analytic-lines",
            "analytic-distribution-models",
            "tax-groups",
            "tax-jurisdictions",
            "tax-schedules",
            "tax-deadlines",
            "account-payment-terms",
            "account-payment-term-lines",
        ],
    ),
    (
        "sales",
        &[
            "sale-orders",
            "sale-order-lines",
            "sale-order-options",
            "pricelists",
            "pricelist-items",
            "sale-commission-plans",
            "sale-commission-plan-splits",
            "sale-commissions",
            "delivery-carriers",
            "shipping-methods",
        ],
    ),
    (
        "crm",
        &[
            "contacts",
            "leads",
            "opportunities",
            "opportunity-lines",
            "activities",
            "contact-tags",
            "contact-categories",
            "contact-segments",
            "opportunity-stages",
        ],
    ),
    (
        "purchasing",
        &[
            "purchase-orders",
            "purchase-order-lines",
            "purchase-requisitions",
            "purchase-requisition-lines",
            "purchase-rfqs",
            "purchase-rfq-lines",
            "purchase-rfq-bids",
            "purchase-blanket-orders",
            "purchase-blanket-order-lines",
            "purchase-returns",
            "purchase-return-lines",
            "product-supplier-infos",
            "partner-banks",
        ],
    ),
    (
        "reports",
        &[
            "financial-reports",
            "report-templates",
            "scheduled-reports",
            "dashboards",
            "dashboard-widgets",
            "analytics-metrics",
        ],
    ),
    (
        "subscriptions",
        &[
            "subscriptions",
            "subscription-plans",
            "subscription-lines",
            "subscription-amendments",
            "subscription-billing-runs",
            "subscription-usage-events",
            "subscription-usage-charges",
            "subscription-price-tiers",
            "subscription-bundles",
            "subscription-bundle-items",
            "subscription-entitlements",
            "subscription-payment-intents",
        ],
    ),
    (
        "expenses",
        &[
            "expenses",
            "expense-sheets",
            "expense-receipts",
            "expense-advances",
            "expense-allocations",
            "expense-policy-exceptions",
            "expense-mileage-rates",
            "expense-per-diem-rates",
        ],
    ),
    ("products", &["products", "product-categories", "uoms"]),
    (
        "warehouse",
        &[
            "stock-quants",
            "stock-moves",
            "stock-move-lines",
            "stock-pickings",
            "stock-production-lots",
            "stock-production-serials",
            "stock-inventories",
            "stock-cycle-counts",
            "inventory-adjustments",
            "warehouses",
            "stock-locations",
            "replenishment-rules",
        ],
    ),
    (
        "fleet",
        &[
            "fleet-vehicles",
            "fleet-service-records",
            "fleet-inspections",
            "fleet-service-types",
        ],
    ),
    (
        "documents",
        &[
            "documents",
            "document-versions",
            "document-folders",
            "document-templates",
            "knowledge-articles",
            "knowledge-categories",
        ],
    ),
    ("calendar", &["calendar-events"]),
    ("tasks", &["tasks"]),
    ("approvals", &["workflow-instances"]),
    (
        "settings",
        &[
            "companies",
            "roles",
            "user-organization",
            "user-profile",
            "user-role-assignment",
            "form-configs",
            "form-config-fields",
            "form-field-labels",
            "form-role-configs",
            "user-custom-fields",
            "data-classifications",
            "data-classification-rules",
        ],
    ),
];

const SUPPORTING_ADAPTERS: &[RecordAdapter] = &[
    RecordAdapter {
        table: "workflow_human_task",
        resource: "workflow-human-tasks",
        module: "approvals",
    },
    RecordAdapter {
        table: "ai_action_draft",
        resource: "ai-action-drafts",
        module: "ai-assistant",
    },
];

pub(super) fn record_adapters() -> Vec<RecordAdapter> {
    MODULE_RESOURCES
        .iter()
        .flat_map(|(module, resources)| {
            resources.iter().filter_map(move |resource| {
                registry_get(resource).map(|entry| RecordAdapter {
                    table: entry.table.as_str(),
                    resource,
                    module,
                })
            })
        })
        .chain(SUPPORTING_ADAPTERS.iter().copied())
        .collect()
}

fn permission_resource(adapter: &RecordAdapter) -> &str {
    // The existing private workflow source owner gates virtual human tasks on
    // workflow:read, then applies candidate, assignment and delegation scope.
    if adapter.resource == "workflow-human-tasks" {
        "workflows"
    } else if adapter.resource == "ai-action-drafts" {
        "ai_action_draft"
    } else {
        adapter.resource
    }
}

pub(super) fn source_read_allowed(access: &FieldAccessContext, adapter: &RecordAdapter) -> bool {
    has_resource_read_permission(Some(access), permission_resource(adapter))
        && !resource_read_denied(access, adapter.resource)
        && !resource_read_denied(access, adapter.table)
}

pub(super) fn record_adapter(table: &str) -> Result<RecordAdapter, ApiError> {
    let table = canonical_table(table);
    record_adapters()
        .into_iter()
        .find(|adapter| adapter.table == table || adapter.resource == table)
        .ok_or_else(|| ApiError::NotFound("History resource not available".into()))
}

fn canonical_table(table: &str) -> &str {
    match table {
        // Historical native Expense producers used the old model label.
        "hr_expense_sheet" => "expense_sheet",
        "document_folder" => "doc_folder",
        "knowledge_article_category" => "kb_category",
        other => other,
    }
}

fn resource_predicate(adapter: &RecordAdapter) -> String {
    let alias = match adapter.table {
        "expense_sheet" => Some("hr_expense_sheet"),
        "doc_folder" => Some("document_folder"),
        "kb_category" => Some("knowledge_article_category"),
        _ => None,
    };
    alias.map_or_else(
        || format!("resource = '{}'", adapter.table),
        |alias| format!("(resource = '{}' OR resource = '{alias}')", adapter.table),
    )
}

fn require_history_access(access: &FieldAccessContext) -> Result<(), ApiError> {
    if !permission_allowed(access, "business_history", "read") {
        return Err(ApiError::Forbidden(
            "Change history read permission denied".into(),
        ));
    }
    Ok(())
}

fn visible_fields(
    access: &FieldAccessContext,
    adapter: &RecordAdapter,
) -> Result<HashSet<String>, ApiError> {
    require_history_access(access)?;
    let permission = permission_resource(adapter);
    if !source_read_allowed(access, adapter) {
        return Err(ApiError::Forbidden(
            "History source read permission denied".into(),
        ));
    }
    let supporting_fields: Option<&[&str]> = match adapter.resource {
        "workflow-human-tasks" => Some(&["status", "revision", "decision"]),
        "ai-action-drafts" => Some(&[
            "status",
            "confidence",
            "elevated",
            "reviewed_at",
            "executed_at",
            "execution_record_id",
            "expires_at",
        ]),
        _ => None,
    };
    if let Some(fields) = supporting_fields {
        // These virtual source owners have no registry field descriptor. An
        // explicit projection for that source therefore fails closed instead
        // of treating unknown fields as an unrestricted historical grant.
        let restricted = access.field_permissions.iter().any(|rule| {
            rule.action.eq_ignore_ascii_case("read")
                && (rule.resource == "*"
                    || [adapter.resource, adapter.table, permission]
                        .iter()
                        .any(|resource| {
                            rule.resource.replace('-', "_") == resource.replace('-', "_")
                        }))
        });
        if restricted {
            return Ok(HashSet::new());
        }
        return Ok(fields
            .iter()
            .filter(|field| has_resource_field_read_permission(Some(access), permission, field))
            .map(|field| (*field).to_owned())
            .collect());
    }
    Ok(resolve_http_sql_columns(adapter.resource, Some(access))
        .map_err(ApiError::Internal)?
        .into_iter()
        .filter(|field| history_field_allowed(field))
        .collect())
}

fn summary_allowed(
    access: &FieldAccessContext,
    adapter: &RecordAdapter,
    fields: &HashSet<String>,
) -> Result<bool, ApiError> {
    if fields.is_empty() {
        return Ok(false);
    }
    let mut normal = access.clone();
    normal.field_permissions.clear();
    // With no captured field names a partial projection cannot establish that
    // this operation concerned visible fields. Do not disclose such activity.
    Ok(*fields == visible_fields(&normal, adapter)?)
}

fn organization_scope(adapter: &RecordAdapter) -> bool {
    matches!(
        adapter.table,
        "tax_jurisdiction"
            | "tax_deadline"
            | "account_payment_term"
            | "account_payment_term_line"
            | "product_pricelist"
            | "product_pricelist_item"
            | "contact"
            | "lead"
            | "opportunity"
            | "activity"
            | "contact_tag"
            | "contact_category"
            | "contact_segment"
            | "opp_stage"
            | "product_supplier_info"
            | "res_partner_bank"
            | "report_template"
            | "scheduled_report"
            | "dashboard"
            | "dashboard_widget"
            | "analytics_metric"
            | "product"
            | "product_category"
            | "uom"
            | "stock_location"
            | "fleet_vehicle_service_type"
            | "document"
            | "document_version"
            | "doc_folder"
            | "document_template"
            | "knowledge_article"
            | "kb_category"
            | "calendar_event"
            | "company"
            | "role"
            | "user_profile"
            | "user_organization"
            | "user_role_assignment"
            | "form_config"
            | "form_config_field"
            | "form_field_label"
            | "form_role_config"
            | "user_custom_field"
            | "data_classification"
            | "data_classification_rule"
    )
}

fn history_field_allowed(field: &str) -> bool {
    // These fields contain arbitrary payloads or credentials; a resource's
    // present-day default read projection does not admit them into history.
    !matches!(
        field,
        "id" | "organization_id"
            | "company_id"
            | "create_uid"
            | "create_date"
            | "write_uid"
            | "write_date"
            | "metadata"
            | "password"
            | "password_hash"
            | "secret"
            | "token"
            | "access_token"
            | "refresh_token"
            | "api_key"
            | "private_key"
            | "credentials"
    ) && !field.ends_with("_secret")
        && !field.ends_with("_token")
        && !field.ends_with("_password")
}

pub(super) async fn require_record(
    owner: &StdbClient,
    context: &TrustedOperationContext,
    adapter: &RecordAdapter,
    company: u64,
    record: u64,
) -> Result<(), ApiError> {
    require_record_with_access(
        owner,
        context,
        adapter,
        company,
        record,
        context.field_access(),
    )
    .await
}

pub(super) async fn require_record_with_access(
    owner: &StdbClient,
    context: &TrustedOperationContext,
    adapter: &RecordAdapter,
    company: u64,
    record: u64,
    access: &FieldAccessContext,
) -> Result<(), ApiError> {
    visible_fields(access, adapter)?;
    resolve_membership_company_id(
        context.client(),
        context.organization_id(),
        context.actor_identity(),
        Some(company),
        "History company scope denied",
    )
    .await?;
    if adapter.resource == "ai-action-drafts" {
        if draft_source_exists(owner, context, company, record).await? {
            return Ok(());
        }
    } else if exact_source_resource(adapter.resource) {
        if execute_authorized_resource_record(
            context.client(),
            adapter.resource,
            context.organization_id(),
            company,
            record,
            Some(access),
        )
        .await?
        .is_some()
        {
            return Ok(());
        }
    } else {
        let rows = read_source_rows(owner, context, adapter, company, access).await?;
        if rows
            .iter()
            .any(|row| number(row, "id", "id") == Some(record))
        {
            return Ok(());
        }
    }
    Err(ApiError::NotFound(
        "History source record not available".into(),
    ))
}

async fn draft_source_exists(
    owner: &StdbClient,
    context: &TrustedOperationContext,
    company: u64,
    record: u64,
) -> Result<bool, ApiError> {
    match super::super::queries::action_drafts::read(owner, context, company, record).await {
        Ok(_) => Ok(true),
        Err(ApiError::NotFound(_) | ApiError::Forbidden(_)) => Ok(false),
        Err(error) => Err(error),
    }
}

async fn read_source_rows(
    owner: &StdbClient,
    context: &TrustedOperationContext,
    adapter: &RecordAdapter,
    company: u64,
    access: &FieldAccessContext,
) -> Result<Vec<Value>, ApiError> {
    // Match the canonical query route's private workflow owner. This fixed
    // dispatch retains its current candidate/identity/company policy; it does
    // not grant owner SQL authority to another URL-selected table.
    let client = if crate::workflow_reads::is_private_workflow_resource(adapter.resource)
        || crate::query_exec::crm_resource(adapter.resource)
    {
        owner
    } else {
        context.client()
    };
    execute_resource_query_for_company(
        client,
        adapter.resource,
        context.organization_id(),
        context.actor_identity(),
        Some(access),
        Some(company),
    )
    .await
}

fn exact_source_resource(resource: &str) -> bool {
    matches!(
        resource,
        "products"
            | "contacts"
            | "sale-orders"
            | "purchase-orders"
            | "tasks"
            | "account-moves"
            | "account-payments"
            | "expense-sheets"
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GeneralEntry {
    #[serde(flatten)]
    entry: HistoryEntry,
    resource: &'static str,
    record_id: String,
}

#[derive(Serialize)]
struct GeneralCoverage {
    status: &'static str,
    operations: Vec<&'static str>,
    message: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GeneralPage {
    schema_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    resource: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    record_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    module: Option<String>,
    company_id: String,
    data: Vec<GeneralEntry>,
    next_cursor: Option<String>,
    coverage: GeneralCoverage,
}

fn cursor_prefix(context: &TrustedOperationContext, company: u64, scope: &str) -> String {
    format!(
        "gh1.{}.{}.{}.{}.",
        context.organization_id(),
        company,
        scope,
        context.actor_identity()
    )
}

fn generic_entry(
    row: &Value,
    org: u64,
    company: Option<u64>,
    adapter: &RecordAdapter,
    fields: &HashSet<String>,
) -> Result<Option<GeneralEntry>, ApiError> {
    let record = number(row, "record_id", "recordId")
        .filter(|id| *id > 0)
        .ok_or_else(malformed_evidence)?;
    let subject_record = number(row, "subject_record_id", "subjectRecordId")
        .filter(|id| *id > 0)
        .ok_or_else(malformed_evidence)?;
    let subject = cell(row, "subject_resource", "subjectResource")
        .and_then(Value::as_str)
        .map(canonical_table)
        .ok_or_else(malformed_evidence)?;
    if number(row, "organization_id", "organizationId") != Some(org)
        || number(row, "company_id", "companyId") != company
        || number(row, "schema_version", "schemaVersion") != Some(1)
        || cell(row, "resource", "resource")
            .and_then(Value::as_str)
            .map(canonical_table)
            != Some(adapter.table)
    {
        return Err(malformed_evidence());
    }
    // The existing Accounting producer records a child change on its parent.
    // Its richer field and relation policy remains the canonical owner.
    if adapter.table == "account_move" && subject == "account_move_line" {
        return Ok(project_entry(
            row,
            org,
            company.ok_or_else(malformed_evidence)?,
            record,
            fields,
        )?
        .map(|entry| GeneralEntry {
            entry,
            resource: adapter.table,
            record_id: record.to_string(),
        }));
    }
    if subject != adapter.table || subject_record != record {
        return Err(malformed_evidence());
    }
    let operation = cell(row, "operation", "operation")
        .and_then(Value::as_str)
        .filter(|op| {
            !op.is_empty()
                && op.len() <= 128
                && *op != "log_audit_event"
                && op
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b':' | b'.' | b'-'))
        })
        .ok_or_else(malformed_evidence)?;
    let encoded = cell(row, "changes_json", "changesJson")
        .and_then(Value::as_str)
        .filter(|value| value.len() <= MAX_EVIDENCE_BYTES)
        .ok_or_else(malformed_evidence)?;
    let mut changes: Vec<HistoryDelta> =
        serde_json::from_str(encoded).map_err(|_| malformed_evidence())?;
    if changes.len() > 64 {
        return Err(malformed_evidence());
    }
    let summary = changes.is_empty();
    let mut seen = HashSet::new();
    if changes.iter().any(|change| {
        change.field.is_empty()
            || !seen.insert(change.field.clone())
            || change.before == change.after
    }) {
        return Err(malformed_evidence());
    }
    changes.retain(|change| fields.contains(&change.field));
    // A summary authored as such is useful. An event containing only hidden
    // field differences must not reveal that private work occurred.
    if fields.is_empty() || (!summary && changes.is_empty()) {
        return Ok(None);
    }
    let actor = cell(row, "actor_identity", "actorIdentity")
        .and_then(identity_cell_to_hex)
        .and_then(|identity| parse_stdb_identity_hex(&identity))
        .ok_or_else(malformed_evidence)?;
    let id = number(row, "id", "id")
        .filter(|id| *id > 0)
        .ok_or_else(malformed_evidence)?;
    Ok(Some(GeneralEntry {
        entry: HistoryEntry {
            id: if company.is_none() {
                format!("org:{id}")
            } else {
                id.to_string()
            },
            operation: operation.into(),
            actor_identity: actor,
            occurred_at: occurred_at(
                cell(row, "occurred_at", "occurredAt").ok_or_else(malformed_evidence)?,
            )?,
            changed_resource: adapter.resource,
            changed_record_id: record.to_string(),
            changes,
        },
        resource: adapter.table,
        record_id: record.to_string(),
    }))
}

struct ProviderPage {
    entries: VecDeque<GeneralEntry>,
    after: u64,
    more: bool,
}

fn provider_unavailable(error: ApiError) -> ApiError {
    match error {
        ApiError::Internal(_) | ApiError::InternalSource(_) => ApiError::Unavailable(
            "Change history evidence is temporarily unavailable. Verify the database schema release matches this API.".into(),
        ),
        other => other,
    }
}

async fn scan_provider(
    owner: &StdbClient,
    context: &TrustedOperationContext,
    selection: &[RecordAdapter],
    record: Option<u64>,
    company: u64,
    organization: bool,
    mut after: u64,
    limit: usize,
    source_rows: &mut HashMap<&'static str, Vec<Value>>,
) -> Result<ProviderPage, ApiError> {
    let permitted = selection
        .iter()
        .copied()
        .filter(|adapter| !organization || organization_scope(adapter))
        .collect::<Vec<_>>();
    if permitted.is_empty() {
        return Ok(ProviderPage {
            entries: VecDeque::new(),
            after,
            more: false,
        });
    }
    let org = context.organization_id();
    let resources = permitted
        .iter()
        .map(resource_predicate)
        .collect::<Vec<_>>()
        .join(" OR ");
    let record_predicate = record
        .map(|id| format!(" AND record_id = {id}"))
        .unwrap_or_default();
    let company_predicate = if organization {
        String::new()
    } else {
        format!(" AND company_id = {company}")
    };
    let predicate =
        format!("organization_id = {org}{company_predicate} AND ({resources}){record_predicate}");
    let table = if organization {
        "organization_business_change"
    } else {
        "business_change"
    };
    let reader = BoundedIdReader::new(owner, table, &predicate);
    let columns = if organization {
        COLUMNS.replace("company_id, ", "")
    } else {
        COLUMNS.to_string()
    };
    let mut data = VecDeque::new();
    let mut probes = 0;
    'windows: for _ in 0..MAX_WINDOWS {
        let Some(witness) = reader.witness(after, None).await? else {
            break;
        };
        reader
            .seek_window_start(&mut after, witness, &mut probes)
            .await?;
        let end = after.saturating_add(ID_WINDOW);
        let mut rows = owner
            .query_sql(&reader.window_sql(&columns, after, end))
            .await
            .map_err(ApiError::internal)?;
        if rows.len() > ID_WINDOW as usize {
            return Err(malformed_evidence());
        }
        rows.sort_by_key(|row| number(row, "id", "id"));
        let mut last = after;
        for row in rows {
            let id = number(&row, "id", "id")
                .filter(|id| *id > last && *id <= end)
                .ok_or_else(malformed_evidence)?;
            last = id;
            after = id;
            let table = cell(&row, "resource", "resource")
                .and_then(Value::as_str)
                .map(canonical_table)
                .ok_or_else(malformed_evidence)?;
            let adapter = permitted
                .iter()
                .find(|adapter| adapter.table == table)
                .ok_or_else(malformed_evidence)?;
            let source_record = number(&row, "record_id", "recordId")
                .filter(|id| record.is_none_or(|expected| *id == expected))
                .ok_or_else(malformed_evidence)?;
            if adapter.resource == "ai-action-drafts" {
                if !draft_source_exists(owner, context, company, source_record).await? {
                    continue;
                }
            } else if exact_source_resource(adapter.resource) {
                if execute_authorized_resource_record(
                    context.client(),
                    adapter.resource,
                    org,
                    company,
                    source_record,
                    Some(context.field_access()),
                )
                .await?
                .is_none()
                {
                    continue;
                }
            } else {
                if !source_rows.contains_key(adapter.resource) {
                    source_rows.insert(
                        adapter.resource,
                        read_source_rows(owner, context, adapter, company, context.field_access())
                            .await?,
                    );
                }
                if !source_rows[adapter.resource]
                    .iter()
                    .any(|row| number(row, "id", "id") == Some(source_record))
                {
                    continue;
                }
            }
            let child = adapter.table == "account_move"
                && cell(&row, "subject_resource", "subjectResource").and_then(Value::as_str)
                    == Some("account_move_line");
            let fields = if child {
                let line = number(&row, "subject_record_id", "subjectRecordId")
                    .ok_or_else(malformed_evidence)?;
                if !current_line_exists(context.client(), org, company, source_record, line).await?
                {
                    continue;
                }
                match require_access(context.field_access()) {
                    Ok(fields) => fields,
                    Err(ApiError::Forbidden(_)) => continue,
                    Err(error) => return Err(error),
                }
            } else {
                visible_fields(context.field_access(), adapter)?
            };
            if let Some(entry) = generic_entry(
                &row,
                org,
                if organization { None } else { Some(company) },
                adapter,
                &fields,
            )? {
                if entry.entry.changes.is_empty()
                    && !summary_allowed(context.field_access(), adapter, &fields)?
                {
                    continue;
                }
                data.push_back(entry);
            }
            if data.len() == limit {
                break 'windows;
            }
        }
        after = end;
        if after == u64::MAX {
            break;
        }
    }
    let more = reader.witness(after, None).await?.is_some();
    Ok(ProviderPage {
        entries: data,
        after,
        more,
    })
}

fn provider_positions(query: &HistoryQuery, prefix: &str) -> Result<(u64, u64), ApiError> {
    query.cursor.as_ref().map_or(Ok((0, 0)), |cursor| {
        let value = cursor.strip_prefix(prefix).ok_or_else(|| {
            ApiError::BadRequest("cursor does not match this history scope".into())
        })?;
        let (company, organization) = value
            .split_once('.')
            .ok_or_else(|| ApiError::BadRequest("invalid history provider cursor".into()))?;
        Ok((
            decimal_id(company)
                .ok_or_else(|| ApiError::BadRequest("invalid company history cursor".into()))?,
            decimal_id(organization).ok_or_else(|| {
                ApiError::BadRequest("invalid organization history cursor".into())
            })?,
        ))
    })
}

fn merge_providers(
    company: &mut ProviderPage,
    organization: &mut ProviderPage,
    starts: (u64, u64),
    limit: usize,
) -> Result<(Vec<GeneralEntry>, (u64, u64), bool), ApiError> {
    let mut positions = starts;
    let mut data = Vec::new();
    while data.len() < limit && (!company.entries.is_empty() || !organization.entries.is_empty()) {
        let choose_organization = match (company.entries.front(), organization.entries.front()) {
            (Some(left), Some(right)) => right.entry.occurred_at < left.entry.occurred_at,
            (None, Some(_)) => true,
            _ => false,
        };
        let entry = if choose_organization {
            organization.entries.pop_front()
        } else {
            company.entries.pop_front()
        }
        .ok_or_else(malformed_evidence)?;
        let id = decimal_id(
            entry
                .entry
                .id
                .strip_prefix("org:")
                .unwrap_or(&entry.entry.id),
        )
        .ok_or_else(malformed_evidence)?;
        if choose_organization {
            positions.1 = id;
        } else {
            positions.0 = id;
        }
        data.push(entry);
    }
    if company.entries.is_empty() {
        positions.0 = company.after;
    }
    if organization.entries.is_empty() {
        positions.1 = organization.after;
    }
    let more = company.more
        || organization.more
        || !company.entries.is_empty()
        || !organization.entries.is_empty();
    Ok((data, positions, more))
}

async fn read_general(
    owner: &StdbClient,
    context: &TrustedOperationContext,
    selection: &[RecordAdapter],
    record: Option<u64>,
    module: Option<&str>,
    query: &HistoryQuery,
) -> Result<GeneralPage, ApiError> {
    let limit = query.validate(record.unwrap_or(1))?;
    require_history_access(context.field_access())?;
    let org = context.organization_id();
    let company = query.company_id;
    resolve_membership_company_id(
        context.client(),
        org,
        context.actor_identity(),
        Some(company),
        "History company scope denied",
    )
    .await?;
    let permitted = selection
        .iter()
        .copied()
        .filter(|adapter| source_read_allowed(context.field_access(), adapter))
        .collect::<Vec<_>>();
    if permitted.is_empty() {
        return Err(ApiError::Forbidden(
            "History source read permission denied".into(),
        ));
    }
    if let Some(record) = record {
        require_record(owner, context, &permitted[0], company, record).await?;
    }
    let scope = module
        .map(|module| format!("module:{module}"))
        .unwrap_or_else(|| format!("{}:{}", permitted[0].table, record.unwrap_or_default()));
    let prefix = cursor_prefix(context, company, &scope);
    let starts = provider_positions(query, &prefix)?;
    let mut source_rows: HashMap<&'static str, Vec<Value>> = HashMap::new();
    let mut company_page = scan_provider(
        owner,
        context,
        &permitted,
        record,
        company,
        false,
        starts.0,
        limit,
        &mut source_rows,
    )
    .await
    .map_err(provider_unavailable)?;
    let mut organization_page = scan_provider(
        owner,
        context,
        &permitted,
        record,
        company,
        true,
        starts.1,
        limit,
        &mut source_rows,
    )
    .await
    .map_err(provider_unavailable)?;
    let (data, positions, more) =
        merge_providers(&mut company_page, &mut organization_page, starts, limit)?;
    let next_cursor = more.then(|| format!("{prefix}{}.{}", positions.0, positions.1));
    // Refresh authority and re-run the canonical source reader before returning
    // any values. A cached initial source match is not a historical ACL grant.
    let current_access = load_field_access_context(owner, context.actor_identity(), org)
        .await
        .map_err(ApiError::Internal)?
        .ok_or_else(|| ApiError::Forbidden("History access is no longer available".into()))?;
    require_history_access(&current_access)?;
    resolve_membership_company_id(
        context.client(),
        org,
        context.actor_identity(),
        Some(company),
        "History company scope denied",
    )
    .await?;
    if record.is_some() {
        visible_fields(&current_access, &permitted[0])?;
    }
    let mut current_rows: HashMap<&str, Vec<Value>> = HashMap::new();
    let mut visible = Vec::new();
    for mut event in data {
        let adapter = permitted
            .iter()
            .find(|adapter| adapter.table == event.resource)
            .ok_or_else(malformed_evidence)?;
        if !source_read_allowed(&current_access, adapter) {
            continue;
        }
        let record_id = decimal_id(&event.record_id).ok_or_else(malformed_evidence)?;
        if adapter.resource == "ai-action-drafts" {
            if !draft_source_exists(owner, context, company, record_id).await? {
                continue;
            }
        } else if exact_source_resource(adapter.resource) {
            if execute_authorized_resource_record(
                context.client(),
                adapter.resource,
                org,
                company,
                record_id,
                Some(&current_access),
            )
            .await?
            .is_none()
            {
                continue;
            }
        } else {
            if !current_rows.contains_key(adapter.resource) {
                current_rows.insert(
                    adapter.resource,
                    read_source_rows(owner, context, adapter, company, &current_access).await?,
                );
            }
            if !current_rows[adapter.resource]
                .iter()
                .any(|row| number(row, "id", "id") == Some(record_id))
            {
                continue;
            }
        }
        let fields = if event.entry.changed_resource == "account-move-lines" {
            let line = decimal_id(&event.entry.changed_record_id).ok_or_else(malformed_evidence)?;
            if !current_line_exists(context.client(), org, company, record_id, line).await? {
                continue;
            }
            match require_access(&current_access) {
                Ok(fields) => fields,
                Err(ApiError::Forbidden(_)) => continue,
                Err(error) => return Err(error),
            }
        } else {
            visible_fields(&current_access, adapter)?
        };
        let summary = event.entry.changes.is_empty();
        if summary && !summary_allowed(&current_access, adapter, &fields)? {
            continue;
        }
        event
            .entry
            .changes
            .retain(|change| fields.contains(&change.field));
        if !fields.is_empty() && (summary || !event.entry.changes.is_empty()) {
            visible.push(event);
        }
    }
    Ok(GeneralPage {
        schema_version: 1,
        resource: record.map(|_| permitted[0].table),
        record_id: record.map(|id| id.to_string()),
        module: module.map(str::to_string),
        company_id: company.to_string(),
        data: visible,
        next_cursor,
        coverage: GeneralCoverage {
            status: "partial",
            operations: vec![],
            message: "Only retained native business-change evidence for currently accessible records is included. Events may contain a summary when exact field values were not captured and the normal material field projection is permitted. Deleted, earlier and uncaptured operations may be unavailable. This is a live paginated history, not a reconstructed record snapshot. Some source families use their current list reader; unavailable or truncated source reads cannot establish complete history.",
        },
    })
}

pub(super) async fn record_get(
    State(state): State<Arc<AppState>>,
    Path((resource, record)): Path<(String, u64)>,
    Query(query): Query<HistoryQuery>,
    OrgSession { session, .. }: OrgSession,
) -> Result<Json<GeneralPage>, ApiError> {
    let adapter = record_adapter(&resource)?;
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    context.require_current_placement(&state.organization_placements)?;
    let page = read_general(
        &state.stdb,
        &context,
        &[adapter],
        Some(record),
        None,
        &query,
    )
    .await?;
    context.require_current_placement(&state.organization_placements)?;
    Ok(Json(page))
}

pub(super) async fn activity_get(
    State(state): State<Arc<AppState>>,
    Path(module): Path<String>,
    Query(query): Query<HistoryQuery>,
    OrgSession { session, .. }: OrgSession,
) -> Result<Json<GeneralPage>, ApiError> {
    let selection = record_adapters()
        .into_iter()
        .filter(|adapter| {
            module == "overview"
                || adapter.module == module
                || (module == "tasks" && adapter.table == "activity")
        })
        .collect::<Vec<_>>();
    if selection.is_empty() {
        return Err(ApiError::NotFound("History module not available".into()));
    }
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    context.require_current_placement(&state.organization_placements)?;
    let page = read_general(
        &state.stdb,
        &context,
        &selection,
        None,
        Some(&module),
        &query,
    )
    .await?;
    context.require_current_placement(&state.organization_placements)?;
    Ok(Json(page))
}

#[cfg(test)]
mod tests;
