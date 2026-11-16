use serde::{Deserialize, Serialize};
use serde_json::Value;
use stdb_client::StdbClient;

use super::{
    audit::{DecisionOutcome, PolicyResult},
    audit_logger::{HarnessAuditLogger, HarnessAuditTrail},
    data_scope_resolver::NamedResourceContract,
    manifest::{
        Capability, ExecutionLimits, PrivacyPolicy, ReviewMetadata, ReviewStatus, RiskClass,
        SkillManifest, SkillVersionRef,
    },
    policy_engine::{
        ExecutionMetadata, ExecutionPlan, PlannedToolCall, PolicyControlledRequest, PolicyEngine,
        PolicyExecutionRequest,
    },
};

pub const LOW_STOCK_SKILL_KEY: &str = "low_stock";
pub const LOW_STOCK_SKILL_VERSION: u32 = 1;
pub const LOW_STOCK_RELEASE_VERSION: &str = "1.0.4";
pub const LOW_STOCK_RESOURCE: &str = "inventory.low_stock.v1";
pub const LOW_STOCK_OUTPUT_TYPE: &str = "inventory.low_stock.result.v1";
pub const NAMED_READ_TOOL: &str = "named_resource_read";
const MAX_SOURCE_ROWS: usize = 500;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LowStockInput {
    pub threshold: f64,
    #[serde(default)]
    pub location_id: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LowStockItem {
    pub organization_id: u64,
    pub company_id: u64,
    pub product_id: u64,
    pub sku: String,
    pub name: String,
    pub quantity_on_hand: f64,
    pub reorder_level: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LowStockOutput {
    pub items: Vec<LowStockItem>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LowStockScanResult {
    pub decision: PolicyResult,
    pub summary: String,
    pub items: Vec<LowStockItem>,
    pub audit: HarnessAuditTrail,
}

pub fn manifest() -> SkillManifest {
    SkillManifest {
        skill: SkillVersionRef::new(LOW_STOCK_SKILL_KEY, LOW_STOCK_SKILL_VERSION),
        review: ReviewMetadata {
            status: ReviewStatus::Promoted,
            reviewed_by: "phase1-policy".to_string(),
            reviewed_at: "2026-07-10T00:00:00Z".to_string(),
        },
        risk: RiskClass::Green,
        named_resources: vec![LOW_STOCK_RESOURCE.to_string()],
        allowed_tools: vec![NAMED_READ_TOOL.to_string()],
        allowed_capabilities: vec![Capability::NamedRead],
        output_type: LOW_STOCK_OUTPUT_TYPE.to_string(),
        limits: ExecutionLimits {
            max_rows: 100,
            max_steps: 1,
            max_tool_calls: 1,
        },
        privacy: PrivacyPolicy::new([
            "organization_id",
            "company_id",
            "product_id",
            "sku",
            "name",
            "quantity_on_hand",
            "reorder_level",
        ]),
    }
}

pub fn resource_contract() -> NamedResourceContract {
    NamedResourceContract {
        name: LOW_STOCK_RESOURCE.to_string(),
        review: ReviewMetadata {
            status: ReviewStatus::Promoted,
            reviewed_by: "phase1-policy".to_string(),
            reviewed_at: "2026-07-10T00:00:00Z".to_string(),
        },
        output_type: LOW_STOCK_OUTPUT_TYPE.to_string(),
        rows_field: "items".to_string(),
        validate_input,
        validate_output,
    }
}

fn validate_input(value: &Value) -> Result<(), String> {
    let input: LowStockInput = serde_json::from_value(value.clone())
        .map_err(|error| format!("invalid low-stock input: {error}"))?;
    if !input.threshold.is_finite() || input.threshold < 0.0 {
        return Err("low-stock threshold must be a finite non-negative number".to_string());
    }
    if input.location_id == Some(0) {
        return Err("low-stock location_id must be a positive record ID".to_string());
    }
    Ok(())
}

fn validate_output(value: &Value) -> Result<(), String> {
    let output: LowStockOutput = serde_json::from_value(value.clone())
        .map_err(|error| format!("invalid low-stock output: {error}"))?;
    if output.items.iter().any(|item| {
        !item.quantity_on_hand.is_finite()
            || !item.reorder_level.is_finite()
            || item.quantity_on_hand < 0.0
            || item.reorder_level < 0.0
    }) {
        return Err("low-stock quantities must be finite non-negative numbers".to_string());
    }
    Ok(())
}

/// Scan scoped inventory for products at or below the requested threshold.
pub async fn scan_low_stock(
    stdb: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    input: LowStockInput,
    company_id: u64,
    policy: PolicyEngine,
) -> Result<LowStockScanResult, String> {
    let correlation_id = uuid::Uuid::new_v4().to_string();
    let mut audit = HarnessAuditLogger::new(correlation_id.clone());
    audit.record(
        "requested",
        format!(
            "low_stock org={organization_id} company={company_id} threshold={}",
            input.threshold
        ),
    );

    let output = fetch_low_stock_output(stdb, organization_id, company_id, &input).await?;
    audit.record(
        "resource_accessed",
        format!(
            "inventory.low_stock.v1 returned {} rows",
            output.items.len()
        ),
    );

    finish_low_stock_scan(
        policy,
        organization_id,
        company_id,
        identity_hex,
        input,
        output,
        audit,
    )
}

fn finish_low_stock_scan(
    policy: PolicyEngine,
    organization_id: u64,
    company_id: u64,
    identity_hex: &str,
    input: LowStockInput,
    output: LowStockOutput,
    mut audit: HarnessAuditLogger,
) -> Result<LowStockScanResult, String> {
    let correlation_id = audit.correlation_id().to_string();
    let request = PolicyControlledRequest {
        execution: PolicyExecutionRequest {
            skill: SkillVersionRef::new(LOW_STOCK_SKILL_KEY, LOW_STOCK_SKILL_VERSION),
            organization_id,
            company_id,
            correlation_id: correlation_id.clone(),
            metadata: ExecutionMetadata {
                actor_id: Some(identity_hex.to_string()),
                causation_id: Some(correlation_id),
                ..Default::default()
            },
            input: serde_json::to_value(&input).unwrap_or_default(),
            plan: ExecutionPlan {
                named_resources: vec![LOW_STOCK_RESOURCE.to_string()],
                tool_calls: vec![PlannedToolCall {
                    tool_name: NAMED_READ_TOOL.to_string(),
                    capability: Capability::NamedRead,
                    named_resource: Some(LOW_STOCK_RESOURCE.to_string()),
                }],
                steps: 1,
                expected_rows: output.items.len() as u32,
                output_type: LOW_STOCK_OUTPUT_TYPE.to_string(),
            },
        },
        candidate_output: serde_json::to_value(&output).unwrap_or_default(),
    };

    let decision = policy.execute_controlled(request);
    audit.record(
        "policy",
        format!(
            "outcome={:?} reasons={}",
            decision.decision.outcome,
            decision.decision.reasons.len()
        ),
    );

    if decision.decision.outcome != DecisionOutcome::Allow {
        audit.record("completed", "low_stock scan denied by policy");
        return Ok(LowStockScanResult {
            decision,
            summary: String::new(),
            items: Vec::new(),
            audit: audit.into_trail(),
        });
    }

    let protected = decision
        .output
        .as_ref()
        .ok_or_else(|| "allowed low-stock scan has no protected output".to_string())?;
    let LowStockOutput { items } = LowStockOutput::deserialize(protected)
        .map_err(|error| format!("invalid protected low-stock output: {error}"))?;
    let summary = if items.is_empty() {
        "No low-stock products found for the selected threshold.".to_string()
    } else {
        format!(
            "Found {} product(s) at or below threshold {}.",
            items.len(),
            input.threshold
        )
    };
    audit.record("artifact", "low-stock summary composed");

    Ok(LowStockScanResult {
        decision,
        summary,
        items,
        audit: audit.into_trail(),
    })
}

async fn fetch_low_stock_output(
    stdb: &StdbClient,
    organization_id: u64,
    company_id: u64,
    input: &LowStockInput,
) -> Result<LowStockOutput, String> {
    validate_input(&serde_json::to_value(input).unwrap_or_default())?;

    // Products are organization-shared templates. Company/location ownership
    // belongs to stock_quant, whose product_id still names the template when
    // product_variant_id is present. Variant reorder minima are not template
    // fields; this template-level scan uses the explicitly requested threshold.
    let source_limit = MAX_SOURCE_ROWS + 1;
    let product_sql = format!(
        "SELECT id, organization_id, default_code, name FROM product WHERE organization_id = {organization_id} LIMIT {source_limit}"
    );
    let location_filter = input
        .location_id
        .map(|id| format!(" AND location_id = {id}"))
        .unwrap_or_default();
    let quant_sql = format!(
        "SELECT organization_id, company_id, product_id, location_id, quantity FROM stock_quant WHERE organization_id = {organization_id} AND company_id = {company_id}{location_filter} LIMIT {source_limit}"
    );

    let products = stdb
        .query_sql(&product_sql)
        .await
        .map_err(|error| format!("load products: {error}"))?;
    let quants = stdb
        .query_sql(&quant_sql)
        .await
        .map_err(|error| format!("load stock quants: {error}"))?;

    evaluate_low_stock_rows(
        &products,
        &quants,
        organization_id,
        company_id,
        input,
        manifest().limits.max_rows as usize,
    )
}

pub(crate) fn evaluate_low_stock_rows(
    products: &[Value],
    quants: &[Value],
    organization_id: u64,
    company_id: u64,
    input: &LowStockInput,
    max_rows: usize,
) -> Result<LowStockOutput, String> {
    validate_input(&serde_json::to_value(input).map_err(|error| error.to_string())?)?;
    if products.len() > MAX_SOURCE_ROWS || quants.len() > MAX_SOURCE_ROWS {
        return Err("low-stock source row limit exceeded".to_string());
    }
    let mut quantity_by_product = std::collections::BTreeMap::<u64, f64>::new();
    for row in quants {
        if row_u64(row, "organizationId", "organization_id") != Some(organization_id)
            || row_u64(row, "companyId", "company_id") != Some(company_id)
        {
            return Err("low-stock quant scope mismatch".to_string());
        }
        let location_id = required_id(row, "locationId", "location_id")?;
        if input.location_id.is_some() && Some(location_id) != input.location_id {
            continue;
        }
        let product_id = required_id(row, "productId", "product_id")?;
        let quantity = row_f64(row, "quantity")
            .filter(|value| value.is_finite())
            .ok_or("low-stock quant quantity is missing or invalid")?;
        let total = quantity_by_product.entry(product_id).or_default();
        *total += quantity;
        if !total.is_finite() {
            return Err("low-stock quantity total is not finite".to_string());
        }
    }

    let mut items = Vec::new();
    for row in products {
        if row_u64(row, "organizationId", "organization_id") != Some(organization_id) {
            return Err("low-stock product organization mismatch".to_string());
        }
        let product_id = required_id(row, "id", "id")?;
        let quantity_on_hand = quantity_by_product.get(&product_id).copied().unwrap_or(0.0);
        if quantity_on_hand > input.threshold {
            continue;
        }
        items.push(LowStockItem {
            organization_id,
            company_id,
            product_id,
            sku: row_string(&row, "defaultCode", Some("default_code")).unwrap_or_default(),
            name: row_string(&row, "name", None).ok_or("low-stock product name is missing")?,
            quantity_on_hand,
            reorder_level: input.threshold,
        });
        if items.len() > max_rows {
            return Err("low-stock row limit exceeded".to_string());
        }
    }

    items.sort_by(|left, right| {
        left.quantity_on_hand
            .total_cmp(&right.quantity_on_hand)
            .then(left.product_id.cmp(&right.product_id))
    });

    let output = LowStockOutput { items };
    validate_output(&serde_json::to_value(&output).unwrap_or_default())?;
    Ok(output)
}

use crate::wire_decode::{row_u64, snake_to_camel};

fn required_id(row: &Value, camel: &str, snake: &str) -> Result<u64, String> {
    row_u64(row, camel, snake)
        .filter(|id| *id > 0)
        .ok_or_else(|| format!("low-stock {snake} must be a positive record ID"))
}

fn row_f64(row: &Value, field: &str) -> Option<f64> {
    let camel = snake_to_camel(field);
    row.get(&camel)
        .or_else(|| row.get(field))
        .and_then(|value| value.as_f64().or_else(|| value.as_str()?.parse().ok()))
}

fn row_string(row: &Value, camel: &str, snake: Option<&str>) -> Option<String> {
    row.get(camel)
        .or_else(|| snake.and_then(|field| row.get(field)))
        .and_then(Value::as_str)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::manifest::OrgPrivacyPolicy;

    #[test]
    fn low_stock_contract_accepts_typed_values() {
        validate_input(&serde_json::json!({"threshold": 5.0, "location_id": 9})).unwrap();
        validate_output(&serde_json::json!({
            "items": [{
                "organization_id": 1,
                "company_id": 2,
                "product_id": 3,
                "sku": "W-1",
                "name": "Widget",
                "quantity_on_hand": 2.0,
                "reorder_level": 5.0
            }]
        }))
        .unwrap();
    }

    #[test]
    fn low_stock_contract_rejects_unknown_input_fields() {
        let error =
            validate_input(&serde_json::json!({"threshold": 5.0, "sql": "SELECT *"})).unwrap_err();
        assert!(error.contains("unknown field"));
    }

    fn input(location_id: Option<u64>) -> LowStockInput {
        LowStockInput {
            threshold: 4.0,
            location_id,
        }
    }

    fn product(id: u64) -> Value {
        serde_json::json!({
            "id": id, "organizationId": 7, "defaultCode": format!("SKU-{id}"),
            "name": format!("Template {id}")
        })
    }

    fn quant(product_id: u64, location_id: u64, quantity: f64) -> Value {
        serde_json::json!({
            "organizationId": 7, "companyId": 9, "productId": product_id,
            "locationId": location_id, "quantity": quantity
        })
    }

    #[test]
    fn template_scan_sums_variant_quants_and_uses_the_entered_threshold() {
        let products = vec![product(20), product(21), product(22)];
        let mut first = quant(20, 4, 2.0);
        first["productVariantId"] = Value::from(201);
        let mut second = quant(20, 4, 1.0);
        second["productVariantId"] = Value::from(202);
        let output = evaluate_low_stock_rows(
            &products,
            &[first, second, quant(21, 4, 9.0)],
            7,
            9,
            &input(None),
            100,
        )
        .unwrap();

        assert_eq!(output.items.len(), 2);
        assert_eq!(output.items[0].product_id, 22);
        assert_eq!(output.items[0].quantity_on_hand, 0.0);
        assert_eq!(output.items[1].product_id, 20);
        assert_eq!(output.items[1].quantity_on_hand, 3.0);
        assert_eq!(output.items[1].sku, "SKU-20");
        assert!(output.items.iter().all(|item| {
            item.organization_id == 7 && item.company_id == 9 && item.reorder_level == 4.0
        }));
    }

    #[test]
    fn location_filter_never_borrows_another_locations_stock() {
        let output = evaluate_low_stock_rows(
            &[product(20)],
            &[quant(20, 4, 2.0), quant(20, 5, 99.0)],
            7,
            9,
            &input(Some(4)),
            100,
        )
        .unwrap();
        assert_eq!(output.items[0].quantity_on_hand, 2.0);
        assert!(
            validate_input(&serde_json::json!({"threshold": 4.0, "location_id": 0}))
                .unwrap_err()
                .contains("positive record ID")
        );
    }

    #[test]
    fn foreign_company_or_organization_rows_fail_closed() {
        let mut foreign_company = quant(20, 4, 2.0);
        foreign_company["companyId"] = Value::from(10);
        let mut foreign_org = quant(20, 4, 2.0);
        foreign_org["organizationId"] = Value::from(8);
        for row in [foreign_company, foreign_org] {
            assert_eq!(
                evaluate_low_stock_rows(&[product(20)], &[row], 7, 9, &input(None), 100)
                    .unwrap_err(),
                "low-stock quant scope mismatch"
            );
        }
        let mut foreign_product = product(20);
        foreign_product["organizationId"] = Value::from(8);
        assert_eq!(
            evaluate_low_stock_rows(&[foreign_product], &[], 7, 9, &input(None), 100).unwrap_err(),
            "low-stock product organization mismatch"
        );
    }

    #[test]
    fn invalid_source_values_do_not_become_zero_stock_or_invented_products() {
        let mut missing_quantity = quant(20, 4, 2.0);
        missing_quantity.as_object_mut().unwrap().remove("quantity");
        assert!(evaluate_low_stock_rows(
            &[product(20)],
            &[missing_quantity],
            7,
            9,
            &input(None),
            100
        )
        .unwrap_err()
        .contains("quantity is missing or invalid"));
        let mut missing_name = product(20);
        missing_name.as_object_mut().unwrap().remove("name");
        assert!(
            evaluate_low_stock_rows(&[missing_name], &[], 7, 9, &input(None), 100)
                .unwrap_err()
                .contains("name is missing")
        );
        assert!(evaluate_low_stock_rows(
            &[product(20)],
            &[quant(0, 4, 2.0)],
            7,
            9,
            &input(None),
            100
        )
        .unwrap_err()
        .contains("positive record ID"));
        assert!(evaluate_low_stock_rows(
            &[product(20)],
            &[quant(20, 4, f64::MAX), quant(20, 4, f64::MAX)],
            7,
            9,
            &input(None),
            100
        )
        .unwrap_err()
        .contains("not finite"));
    }

    #[test]
    fn source_and_output_limits_reject_incomplete_scans() {
        for (products, quants) in [
            (vec![product(20); MAX_SOURCE_ROWS + 1], vec![]),
            (
                vec![product(20)],
                vec![quant(20, 4, 1.0); MAX_SOURCE_ROWS + 1],
            ),
        ] {
            assert_eq!(
                evaluate_low_stock_rows(&products, &quants, 7, 9, &input(None), 100).unwrap_err(),
                "low-stock source row limit exceeded"
            );
        }
        assert_eq!(
            evaluate_low_stock_rows(&[product(20), product(21)], &[], 7, 9, &input(None), 1)
                .unwrap_err(),
            "low-stock row limit exceeded"
        );
    }

    #[tokio::test]
    async fn native_http_queries_use_real_columns_and_keep_company_location_scope() {
        use axum::{http::HeaderMap, routing::post, Json, Router};
        use std::sync::{Arc, Mutex};

        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = requests.clone();
        let app = Router::new().route(
            "/v1/database/fixture/sql",
            post(move |headers: HeaderMap, sql: String| {
                let recorded = recorded.clone();
                async move {
                    assert_eq!(headers["authorization"], "Bearer actor-fixture-token");
                    recorded.lock().unwrap().push(sql.clone());
                    let (columns, rows) = if sql.contains(" FROM product ") {
                        assert_eq!(sql, "SELECT id, organization_id, default_code, name FROM product WHERE organization_id = 7 LIMIT 501");
                        (
                            vec!["id", "organization_id", "default_code", "name"],
                            vec![serde_json::json!([20, 7, [0, "REAL-SKU"], "Real template"])],
                        )
                    } else {
                        assert_eq!(sql, "SELECT organization_id, company_id, product_id, location_id, quantity FROM stock_quant WHERE organization_id = 7 AND company_id = 9 AND location_id = 4 LIMIT 501");
                        (
                            vec!["organization_id", "company_id", "product_id", "location_id", "quantity"],
                            vec![serde_json::json!([7, 9, 20, 4, 2.5])],
                        )
                    };
                    Json(serde_json::json!([{
                        "schema": {"elements": columns.into_iter().map(|name| {
                            let kind = match name {
                                "default_code" => serde_json::json!({"Sum": {"variants": [
                                    {"name": {"some": "some"}, "algebraic_type": {"String": []}},
                                    {"name": {"some": "none"}, "algebraic_type": {"Product": {"elements": []}}}
                                ]}}),
                                "name" => serde_json::json!({"String": []}),
                                "quantity" => serde_json::json!({"F64": []}),
                                _ => serde_json::json!({"U64": []}),
                            };
                            serde_json::json!({"name": {"some": name}, "algebraic_type": kind})
                        }).collect::<Vec<_>>()},
                        "rows": rows
                    }]))
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = StdbClient::new(
            format!("http://{address}"),
            "fixture".into(),
            "actor-fixture-token".into(),
        )
        .with_http_client(reqwest::Client::builder().no_proxy().build().unwrap());
        let result = fetch_low_stock_output(&client, 7, 9, &input(Some(4))).await;
        server.abort();
        let output = result.unwrap();
        assert_eq!(requests.lock().unwrap().len(), 2);
        assert_eq!(output.items[0].product_id, 20);
        assert_eq!(output.items[0].sku, "REAL-SKU");
        assert_eq!(output.items[0].quantity_on_hand, 2.5);
        assert_eq!(output.items[0].reorder_level, 4.0);
    }

    #[test]
    fn low_stock_result_returns_the_policy_protected_items() {
        let policy = PolicyEngine::default().with_org_privacy(OrgPrivacyPolicy {
            masked_fields: vec!["sku".to_string()],
            ..Default::default()
        });
        let input = LowStockInput {
            threshold: 5.0,
            location_id: None,
        };
        let output = LowStockOutput {
            items: vec![LowStockItem {
                organization_id: 1,
                company_id: 2,
                product_id: 3,
                sku: "Private-SKU-1234".to_string(),
                name: "Widget".to_string(),
                quantity_on_hand: 2.0,
                reorder_level: 5.0,
            }],
        };
        let result = finish_low_stock_scan(
            policy,
            1,
            2,
            "fixture",
            input,
            output,
            HarnessAuditLogger::new("correlation"),
        )
        .unwrap();
        assert_eq!(result.decision.decision.outcome, DecisionOutcome::Allow);
        assert_eq!(result.items[0].sku, "[MASKED]…1234");
        assert_eq!(result.items[0].quantity_on_hand, 2.0);
        assert_eq!(result.items[0].reorder_level, 5.0);
        assert_eq!(result.decision.privacy.unwrap().masked_fields, ["sku"]);
    }
}
