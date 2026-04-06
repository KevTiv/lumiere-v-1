//! `/v1/proposals/*` — parity with `frontend/web/app/api/proposals/analyze/route.ts`.

use std::sync::Arc;
use std::time::Duration;

use axum::{extract::State, http::StatusCode, routing::post, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeRequest {
    text: String,
}

fn mock_analysis(text: &str) -> Value {
    let word_count = text.split_whitespace().filter(|s| !s.is_empty()).count();
    let sentences: Vec<&str> = text
        .split(|c| c == '.' || c == '!' || c == '?')
        .map(|s| s.trim())
        .filter(|s| s.len() > 20)
        .take(6)
        .collect();

    let findings: Vec<Value> = sentences
        .iter()
        .take(4)
        .enumerate()
        .map(|(i, s)| {
            let rel = ["high", "medium", "low", "medium"][i % 4];
            let cat = [
                "Requirements",
                "Technical",
                "Commercial",
                "Compliance",
            ][i % 4];
            json!({
                "id": format!("f-{i}"),
                "title": format!("Finding {}", i + 1),
                "excerpt": s.chars().take(200).collect::<String>(),
                "relevance": rel,
                "category": cat,
            })
        })
        .collect();

    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    json!({
        "summary": format!(
            "This document contains {word_count} words describing procurement requirements. The analysis has identified {} key findings, 6 requirements to address, and 4 evaluation criteria to optimise against.",
            findings.len()
        ),
        "keyFindings": findings,
        "requirements": [
            { "id": "r-1", "text": "Provide a detailed project plan with milestones and deliverables", "category": "Project Management", "mandatory": true, "addressed": false },
            { "id": "r-2", "text": "Demonstrate relevant experience with at least 3 case studies", "category": "Experience", "mandatory": true, "addressed": false },
            { "id": "r-3", "text": "Submit a complete pricing breakdown by deliverable", "category": "Commercial", "mandatory": true, "addressed": false },
            { "id": "r-4", "text": "Comply with local data sovereignty requirements", "category": "Compliance", "mandatory": true, "addressed": false },
            { "id": "r-5", "text": "Provide a dedicated project manager and named resources", "category": "Resourcing", "mandatory": false, "addressed": false },
            { "id": "r-6", "text": "Detail your quality assurance and testing methodology", "category": "Quality", "mandatory": false, "addressed": false },
        ],
        "evaluationCriteria": [
            { "id": "ec-1", "name": "Technical Capability", "weight": 35, "description": "Demonstrated ability to deliver", "addressed": false },
            { "id": "ec-2", "name": "Commercial Competitiveness", "weight": 30, "description": "Value for money and pricing clarity", "addressed": false },
            { "id": "ec-3", "name": "Experience & References", "weight": 20, "description": "Relevant prior work", "addressed": false },
            { "id": "ec-4", "name": "Methodology & Approach", "weight": 15, "description": "Quality of proposed approach", "addressed": false },
        ],
        "concepts": [
            { "id": "c-1", "term": "RFP", "definition": "Request for Proposal — a document soliciting bids from vendors", "frequency": 3 },
            { "id": "c-2", "term": "SLA", "definition": "Service Level Agreement — contractual performance commitments", "frequency": 2 },
            { "id": "c-3", "term": "Deliverables", "definition": "Tangible outputs or outcomes promised at each milestone", "frequency": 4 },
            { "id": "c-4", "term": "Scope", "definition": "The defined boundaries and features of the project", "frequency": 5 },
        ],
        "suggestedSections": [
            "Executive Summary",
            "Company Profile",
            "Technical Approach",
            "Project Timeline & Milestones",
            "Team & Qualifications",
            "Pricing & Commercial Terms",
            "Compliance & Certifications",
        ],
        "analyzedAt": now,
    })
}

fn parse_gateway_response(text: &str, response_text: &str) -> Value {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    match serde_json::from_str::<Value>(response_text) {
        Ok(parsed) => json!({
            "summary": parsed.get("summary").cloned().unwrap_or_else(|| {
                json!(response_text.chars().take(500).collect::<String>())
            }),
            "keyFindings": parsed.get("keyFindings").cloned().unwrap_or(json!([])),
            "requirements": parsed.get("requirements").cloned().unwrap_or(json!([])),
            "evaluationCriteria": parsed.get("evaluationCriteria").cloned().unwrap_or(json!([])),
            "concepts": parsed.get("concepts").cloned().unwrap_or(json!([])),
            "suggestedSections": parsed.get("suggestedSections").cloned().unwrap_or(json!([])),
            "analyzedAt": now,
        }),
        Err(_) => {
            let mut m = mock_analysis(text);
            if let Value::Object(ref mut map) = m {
                map.insert(
                    "summary".into(),
                    json!(response_text.chars().take(1000).collect::<String>()),
                );
            }
            m
        }
    }
}

async fn analyze_post(
    State(state): State<Arc<AppState>>,
    Json(body): Json<AnalyzeRequest>,
) -> (StatusCode, Json<Value>) {
    let text = body.text.trim();
    if text.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "text is required" })),
        );
    }

    let url = format!("{}/v1/rag", state.config.ai_gateway_url);
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
    else {
        return (StatusCode::OK, Json(mock_analysis(text)));
    };

    let gateway_body = json!({
        "query": format!(
            "Analyse the following procurement document. Extract: 1) A concise executive summary (2-3 sentences), 2) Key findings with excerpts, 3) Mandatory and optional requirements, 4) Evaluation criteria and their weights, 5) Key technical concepts and definitions. Return as JSON matching the AIAnalysis schema. Document:\n\n{}",
            text.chars().take(8000).collect::<String>()
        ),
        "collection": "proposals",
        "top_k": 5,
    });

    if let Ok(resp) = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&gateway_body)
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(response_text) = resp.text().await {
                let analysis = parse_gateway_response(text, &response_text);
                return (StatusCode::OK, Json(analysis));
            }
        }
    }

    (StatusCode::OK, Json(mock_analysis(text)))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/proposals/analyze", post(analyze_post))
}
