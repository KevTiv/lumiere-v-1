use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
};

use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::{
    harness::{
        audit::{
            CorrelationMetadata, DecisionHashes, DecisionOutcome, PolicyDecision, PolicyResult,
            PrivacyReport,
        },
        audit_logger::HarnessAuditLogger,
        low_stock::{LowStockItem, LowStockScanResult},
        manifest::{RiskClass, SkillVersionRef},
        policy_engine::PolicyControlledRequest,
        report_composer::{ReportCitation, ReportComposerResult},
    },
    orchestrator::text_answer_gate::{
        TextAnswerOutcome, TextAnswerProvenance, TextAnswerVerification,
    },
    routes::{
        distributor::{GatewayCreditHoldSummaryRequest, GatewayDeliveryRunSummaryRequest},
        harness_skills::{
            GatewayDailyBriefingRequest, GatewayGovernedLlmSkillRequest, GatewayInsightsScanRequest,
        },
        inventory::GatewayLowStockScanRequest,
        report::GatewayReportComposeRequest,
        skill_bindings,
    },
};

fn web_contract(mode: &str, input: Option<Value>) -> Vec<u8> {
    let script =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/tests/ai-gateway-wire-contract.mjs");
    let mut command = Command::new("node");
    command
        .arg(script)
        .arg(mode)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if input.is_some() {
        command.stdin(Stdio::piped());
    }
    let mut child = command
        .spawn()
        .expect("Node is required for the AI gateway wire contract");
    if let Some(input) = input {
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.to_string().as_bytes())
            .unwrap();
    }
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "web contract {mode} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

#[derive(serde::Deserialize)]
struct ForwardedRequest {
    path: String,
    body: Value,
}

impl ForwardedRequest {
    fn decode<T: DeserializeOwned>(&self) -> T {
        serde_json::from_value(self.body.clone())
            .unwrap_or_else(|error| panic!("{} request does not decode: {error}", self.path))
    }
}

#[test]
#[ignore = "requires Node; run by the AI gateway wire contract CI step"]
fn web_requests_decode_as_gateway_dtos() {
    let requests: Vec<ForwardedRequest> =
        serde_json::from_slice(&web_contract("requests", None)).unwrap();
    assert_eq!(requests.len(), 11);
    for request in requests {
        if request.path != "/v1/policy/evaluate" {
            assert_eq!(request.body["orgId"], 17, "{}", request.path);
            assert_eq!(request.body["companyId"], 23, "{}", request.path);
            assert_eq!(request.body["stdbToken"], "test-token", "{}", request.path);
            assert_eq!(
                request.body["identityHex"],
                "a".repeat(64),
                "{}",
                request.path
            );
            assert_eq!(
                request.body["orgPrivacyPolicy"]["suppressSecrets"], true,
                "{}",
                request.path
            );
        }
        match request.path.as_str() {
            "/v1/skills/inventory/low-stock" => {
                let input: GatewayLowStockScanRequest = request.decode();
                assert_eq!(input.threshold, 5.0);
                assert_eq!(input.location_id, request.body["locationId"].as_u64());
            }
            "/v1/skills/report/compose" => {
                let input: GatewayReportComposeRequest = request.decode();
                assert_eq!(input.report_key, "daily_business_summary_v1");
                assert_eq!(input.timezone, "Europe/Amsterdam");
            }
            "/v1/skills/distributor/credit-hold-summary" => {
                assert_eq!(
                    request
                        .decode::<GatewayCreditHoldSummaryRequest>()
                        .minimum_outstanding,
                    Some(100.0)
                );
            }
            "/v1/skills/distributor/delivery-run-summary" => {
                assert!(
                    request
                        .decode::<GatewayDeliveryRunSummaryRequest>()
                        .include_done
                );
            }
            "/v1/skills/insights-scan" => {
                let input: GatewayInsightsScanRequest = request.decode();
                assert_eq!(input.max_insights, Some(3));
                assert_eq!(input.abnormal_amount_threshold, Some(250.0));
            }
            "/v1/skills/daily-briefing" => {
                let input: GatewayDailyBriefingRequest = request.decode();
                assert_eq!(input.since_micros, Some(1000));
                assert_eq!(input.until_micros, Some(2000));
                assert_eq!(input.allowed_modules, vec!["inventory"]);
                assert_eq!(input.activity_query.as_deref(), Some("stock"));
                assert_eq!(input.top_k, Some(2));
            }
            "/v1/skills/process-research"
            | "/v1/skills/price-search"
            | "/v1/skills/supplier-discovery" => {
                let input: GatewayGovernedLlmSkillRequest = request.decode();
                assert_eq!(input.agent_id, Some(5));
                assert_eq!(input.max_steps, Some(2));
                assert_eq!(input.inputs, json!({"itemName": "Tape"}));
            }
            "/v1/policy/evaluate" => {
                let input: PolicyControlledRequest = request.decode();
                assert_eq!(input.execution.organization_id, 17);
                assert_eq!(input.execution.company_id, 23);
                assert_eq!(input.execution.metadata.actor_id, Some("a".repeat(64)));
                assert_eq!(
                    input.execution.plan.tool_calls[0].named_resource.as_deref(),
                    Some("inventory.low_stock.v1")
                );
                assert_eq!(input.execution.input, json!({"location_id": 31}));
                assert_eq!(
                    input.candidate_output,
                    json!({"items": [{"quantity_on_hand": 2}]})
                );
            }
            path => panic!("unrecognized web request path {path}"),
        }
    }
}

#[test]
#[ignore = "requires Node; run by the AI gateway wire contract CI step"]
fn web_route_forwards_current_gateway_discovery() {
    let bindings = [
        "rag_generation",
        "form_suggestion",
        "action_draft_generation",
        "finance_report_review",
        "low_stock",
        "report_composer",
    ]
    .map(|key| skill_bindings::binding(key).unwrap());
    web_contract("bindings", Some(json!(bindings)));
}

fn allowed_result(skill: &str) -> PolicyResult {
    PolicyResult::new(
        PolicyDecision {
            outcome: DecisionOutcome::Allow,
            skill: SkillVersionRef::new(skill, 1),
            risk: Some(RiskClass::Green),
            reasons: vec![],
            correlation: CorrelationMetadata {
                correlation_id: "wire-contract".into(),
                organization_id: 17,
                company_id: 23,
                actor_id: None,
                causation_id: None,
            },
            hashes: DecisionHashes {
                request_hash: "request".into(),
                input_hash: "input".into(),
                manifest_hash: None,
            },
            enforced_limits: None,
        },
        None,
        Some(PrivacyReport {
            rows_processed: 1,
            masked_fields: vec![],
            suppressed_fields: vec![],
        }),
        None,
    )
}

#[test]
#[ignore = "requires Node; run by the AI gateway wire contract CI step"]
fn web_consumers_read_gateway_skill_results() {
    let audit = HarnessAuditLogger::new("wire-contract").into_trail();
    let low_stock = LowStockScanResult {
        decision: allowed_result("low_stock"),
        summary: "One item needs replenishment".into(),
        items: vec![LowStockItem {
            organization_id: 17,
            company_id: 23,
            product_id: 31,
            sku: "TAPE".into(),
            name: "Tape".into(),
            quantity_on_hand: 2.0,
            reorder_level: 5.0,
        }],
        audit: audit.clone(),
    };
    let report = ReportComposerResult {
        decision: allowed_result("report_composer"),
        summary: "Summary unavailable".into(),
        citations: vec![ReportCitation {
            source: "report".into(),
            label: "Total".into(),
            value_minor_units: 123,
        }],
        summary_verification: TextAnswerVerification {
            outcome: TextAnswerOutcome::Blocked,
            methods: vec!["deterministic"],
            limitations: vec![],
            reason: Some("fixture".into()),
        },
        summary_provenance: TextAnswerProvenance::withheld("fixture"),
        audit,
    };
    web_contract(
        "results",
        Some(json!({ "lowStock": low_stock, "report": report })),
    );
}
