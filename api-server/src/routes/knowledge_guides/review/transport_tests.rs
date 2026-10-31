use super::*;
use axum::{http::HeaderMap, routing::post};
use std::{collections::BTreeMap, sync::Mutex};
use stdb_client::StdbClient;

const TABLES: [&str; 5] = [
    "ai_evidence_decision",
    "ai_evidence_claim",
    "ai_evidence_passage",
    "ai_evidence_source_version",
    "ai_evidence_source",
];
type Rows = BTreeMap<&'static str, Vec<Value>>;

fn graph() -> Rows {
    BTreeMap::from([
        (
            TABLES[0],
            vec![
                json!({"id":11,"status":"accepted","adopted_claim_ids":[21],"supporting_claim_ids":[]}),
                json!({"id":12,"status":"accepted","adopted_claim_ids":[22],"supporting_claim_ids":[]}),
            ],
        ),
        (
            TABLES[1],
            vec![
                json!({"id":21,"status":"current","supporting_passage_ids":[31],"contradicting_passage_ids":[]}),
                json!({"id":22,"status":"current","supporting_passage_ids":[32],"contradicting_passage_ids":[]}),
            ],
        ),
        (
            TABLES[2],
            vec![
                json!({"id":31,"company_id":9,"status":"current","text_state":"present","source_version_id":[0,41]}),
                json!({"id":32,"company_id":9,"status":"current","text_state":"present","source_version_id":[0,42]}),
            ],
        ),
        (
            TABLES[3],
            vec![
                json!({"id":41,"source_id":51,"status":"current","verification":"inspected"}),
                json!({"id":42,"source_id":52,"status":"current","verification":"inspected"}),
            ],
        ),
        (
            TABLES[4],
            vec![
                json!({"id":51,"company_id":9,"scope":"company"}),
                json!({"id":52,"company_id":23,"scope":"organization"}),
            ],
        ),
    ])
}

fn candidate() -> Value {
    json!({"decision_ids":[11,12],"claim_ids":[21],"source_passage_ids":[31]})
}

struct Fixture {
    client: StdbClient,
    calls: Arc<Mutex<Vec<String>>>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn start_fixture(rows: Rows) -> Fixture {
    type FixtureState = (Rows, Arc<Mutex<Vec<String>>>);
    async fn sql(
        State((rows, calls)): State<FixtureState>,
        headers: HeaderMap,
        query: String,
    ) -> Json<Value> {
        assert_eq!(headers["authorization"], "Bearer fixture-owner-token");
        assert!(!query.contains(" IN "), "unsupported SpacetimeDB SQL");
        let (projection, tail) = query
            .strip_prefix("SELECT ")
            .unwrap()
            .split_once(" FROM ")
            .unwrap();
        let (table, predicate) = tail.split_once(" WHERE ").unwrap();
        assert!(predicate.starts_with("organization_id = 7 AND "));
        if table == TABLES[0] || table == TABLES[1] {
            assert!(predicate.starts_with("organization_id = 7 AND company_id = 9 AND (id = "));
        } else {
            assert!(predicate.starts_with("organization_id = 7 AND (id = "));
        }
        assert!(predicate.ends_with(") LIMIT 201"));
        calls.lock().unwrap().push(query.clone());
        let columns: Vec<_> = projection.split(", ").collect();
        // The optional native source_version_id must pass through the real
        // StdbClient SATS decoder, including tagged some/none values.
        let elements: Vec<_> = columns
            .iter()
            .map(|column| {
                if *column == "source_version_id" {
                    json!({"name":{"some":column},"algebraic_type":{"Sum":{"variants":[
                        {"name":{"some":"some"},"algebraic_type":{"U64":[]}},
                        {"name":{"some":"none"},"algebraic_type":{"Product":{"elements":[]}}}
                    ]}}})
                } else {
                    json!({"name":{"some":column}})
                }
            })
            .collect();
        Json(
            json!([{"schema":{"elements":elements},"rows":rows[table].iter().map(|row| {
            columns.iter().map(|column|row[*column].clone()).collect::<Vec<_>>()
        }).collect::<Vec<_>>() }]),
        )
    }
    let calls = Arc::new(Mutex::new(Vec::new()));
    let router = Router::new()
        .route("/v1/database/guide-sql/sql", post(sql))
        .with_state((rows, calls.clone()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let client = StdbClient::new(
        format!("http://{}", listener.local_addr().unwrap()),
        "guide-sql".into(),
        "fixture-owner-token".into(),
    );
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    Fixture {
        client,
        calls,
        task,
    }
}

#[tokio::test]
async fn guide_lineage_executes_supported_scoped_queries_and_decodes_native_options() {
    let fixture = start_fixture(graph()).await;
    assert!(references_current(&fixture.client, 7, 9, &candidate())
        .await
        .unwrap());
    let calls = fixture.calls.lock().unwrap();
    assert_eq!(calls.len(), 5);
    for (index, pair) in [(11, 12), (21, 22), (31, 32), (41, 42), (51, 52)]
        .into_iter()
        .enumerate()
    {
        assert!(calls[index].contains(&format!(
            "FROM {} WHERE organization_id = 7 AND ",
            TABLES[index]
        )));
        assert!(calls[index].ends_with(&format!(
            "AND (id = {} OR id = {}) LIMIT 201",
            pair.0, pair.1
        )));
    }
}

#[tokio::test]
async fn guide_lineage_rejects_missing_partial_duplicate_wrong_or_truncated_results_at_every_level()
{
    for table in TABLES {
        for defect in ["missing", "partial", "duplicate", "wrong-id", "overflow"] {
            let mut rows = graph();
            let values = rows.get_mut(table).unwrap();
            match defect {
                "missing" => values.clear(),
                "partial" => {
                    values.pop();
                }
                "duplicate" => values[1] = values[0].clone(),
                "wrong-id" => values[1]["id"] = json!(999),
                "overflow" => *values = vec![values[0].clone(); 201],
                _ => unreachable!(),
            }
            let fixture = start_fixture(rows).await;
            assert!(
                !references_current(&fixture.client, 7, 9, &candidate())
                    .await
                    .unwrap(),
                "{table} {defect}"
            );
        }
    }
}

#[tokio::test]
async fn guide_lineage_preserves_current_status_scope_and_unversioned_company_checks() {
    for (table, column, value) in [
        (TABLES[0], "status", json!("proposed")),
        (TABLES[1], "status", json!("superseded")),
        (TABLES[2], "status", json!("withdrawn")),
        (TABLES[2], "text_state", json!("redacted")),
        (TABLES[3], "status", json!("superseded")),
        (TABLES[3], "verification", json!("unverified")),
        (TABLES[4], "company_id", json!(10)),
    ] {
        let mut rows = graph();
        rows.get_mut(table).unwrap()[0][column] = value;
        let fixture = start_fixture(rows).await;
        assert!(
            !references_current(&fixture.client, 7, 9, &candidate())
                .await
                .unwrap(),
            "{table} {column}"
        );
    }
    for company in [9, 10] {
        let mut rows = graph();
        for passage in rows.get_mut(TABLES[2]).unwrap() {
            passage["source_version_id"] = json!([1, []]);
            passage["company_id"] = json!(company);
        }
        let fixture = start_fixture(rows).await;
        assert_eq!(
            references_current(&fixture.client, 7, 9, &candidate())
                .await
                .unwrap(),
            company == 9
        );
        assert_eq!(fixture.calls.lock().unwrap().len(), 3);
    }
}

#[tokio::test]
async fn guide_lineage_rejects_reference_overflow_before_querying_or_truncating() {
    let fixture = start_fixture(graph()).await;
    let mut too_many = candidate();
    too_many["decision_ids"] = json!((1..=33).collect::<Vec<_>>());
    assert!(!references_current(&fixture.client, 7, 9, &too_many)
        .await
        .unwrap());
    assert!(fixture.calls.lock().unwrap().is_empty());

    let mut rows = graph();
    rows.get_mut(TABLES[0]).unwrap()[0]["adopted_claim_ids"] = json!((1..=201).collect::<Vec<_>>());
    let fixture = start_fixture(rows).await;
    assert!(!references_current(&fixture.client, 7, 9, &candidate())
        .await
        .unwrap());
    assert_eq!(fixture.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn guide_review_keeps_fixed_internal_contract_and_human_scoped_sats_transport() {
    use crate::commands::{
        execute_reducer_call, knowledge_guide_review_contract, session_operation_contract,
        session_reducer_contract,
    };
    let contract = knowledge_guide_review_contract().unwrap();
    assert!(session_reducer_contract(contract.name).is_err());
    assert!(session_operation_contract(contract.contract_operation_id).is_err());
    let calls = Arc::new(Mutex::new(Vec::<Value>::new()));
    async fn receive(
        State(calls): State<Arc<Mutex<Vec<Value>>>>,
        headers: HeaderMap,
        Json(args): Json<Value>,
    ) -> axum::http::StatusCode {
        assert_eq!(headers["authorization"], "Bearer human-reviewer-token");
        calls.lock().unwrap().push(args);
        axum::http::StatusCode::NO_CONTENT
    }
    let router = Router::new()
        .route(
            "/v1/database/guide-review/call/review_ai_knowledge_entry_version",
            post(receive),
        )
        .with_state(calls.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let client = StdbClient::new(
        format!("http://{}", listener.local_addr().unwrap()),
        "guide-review".into(),
        "human-reviewer-token".into(),
    );
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let actor = "ab".repeat(32);
    let session = crate::session::ApiSession {
        stdb_token: "human-reviewer-token".into(),
        identity_hex: actor.clone(),
        organization_id: Some(7),
        field_access: Some(FieldAccessContext {
            organization_id: 7,
            identity_hex: actor,
            role_permissions: vec!["ai_knowledge_review:update".into()],
            ..Default::default()
        }),
    };
    let context =
        TrustedOperationContext::from_session(&session, client, contract.contract_operation_id)
            .unwrap()
            .with_company_scope(vec![9])
            .unwrap();
    for note in [
        json!({"some":"Checked this exact guide revision"}),
        json!({"none":[]}),
    ] {
        let args = vec![
            json!(7),
            json!(9),
            json!(9007199254740993u64),
            json!({"review_kind":"implementation","outcome":"accepted","note":note}),
        ];
        let _ = execute_reducer_call(&context, contract, args.clone())
            .await
            .unwrap();
        assert_eq!(calls.lock().unwrap().last(), Some(&json!(args)));
    }
    for (org, company) in [(8, 9), (7, 10)] {
        assert!(execute_reducer_call(
            &context,
            contract,
            vec![
                json!(org),
                json!(company),
                json!(11),
                json!({"review_kind":"implementation","outcome":"accepted","note":{"none":[]}})
            ]
        )
        .await
        .is_err());
    }
    assert_eq!(
        calls.lock().unwrap().len(),
        2,
        "changed authority must fail before native mutation"
    );
    task.abort();
}
