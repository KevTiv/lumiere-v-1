use super::*;
use crate::query_exec::enforce_requested_company;

#[test]
fn sibling_company_is_denied_by_canonical_membership_scope() {
    let error = enforce_requested_company(9, Some(10), "scope mismatch")
        .expect_err("sibling company must be denied");
    assert!(matches!(error, ApiError::Forbidden(_)));
}

#[test]
fn request_contract_rejects_actor_and_organization_spoofing() {
    for extra in [
        json!({ "organizationId": 7 }),
        json!({ "contributorKind": "agent" }),
        json!({ "agentRunId": 22 }),
        json!({ "reducer": "anything" }),
    ] {
        let mut request = json!({
            "companyId": 9,
            "sessionRef": "session-1",
            "eventRef": "event-1",
            "introducedKind": "concept",
            "inspectionState": "unverified_recollection"
        });
        request
            .as_object_mut()
            .expect("object")
            .extend(extra.as_object().expect("extra object").clone());
        assert!(serde_json::from_value::<RecordUserContributionBody>(request).is_err());
    }
}

#[test]
fn request_requires_bounded_idempotency_key() {
    let body = RecordUserContributionBody {
        company_id: 9,
        session_ref: "session-1".into(),
        turn_ref: None,
        event_ref: "x".repeat(MAX_REFERENCE_LENGTH + 1),
        introduced_kind: "concept".into(),
        source_version_id: None,
        passage_id: None,
        inspection_state: "unverified_recollection".into(),
        is_secondary_quotation: false,
        note: None,
    };
    assert!(matches!(validate_body(&body), Err(ApiError::BadRequest(_))));
}

#[test]
fn request_requires_consistent_source_and_inspection_semantics() {
    let mut body = RecordUserContributionBody {
        company_id: 9,
        session_ref: "session-1".into(),
        turn_ref: None,
        event_ref: "event-1".into(),
        introduced_kind: "source_version".into(),
        source_version_id: None,
        passage_id: None,
        inspection_state: "inspected".into(),
        is_secondary_quotation: false,
        note: None,
    };
    assert!(matches!(validate_body(&body), Err(ApiError::BadRequest(_))));
    body.introduced_kind = "concept".into();
    body.source_version_id = Some(11);
    assert!(matches!(validate_body(&body), Err(ApiError::BadRequest(_))));
    body.source_version_id = None;
    body.inspection_state = "trusted_by_model".into();
    assert!(matches!(validate_body(&body), Err(ApiError::BadRequest(_))));
}

#[test]
fn passage_id_and_source_version_id_are_mutually_exclusive_alternatives() {
    let mut body = RecordUserContributionBody {
        company_id: 9,
        session_ref: "session-1".into(),
        turn_ref: None,
        event_ref: "event-1".into(),
        introduced_kind: "source_version".into(),
        source_version_id: Some(11),
        passage_id: Some(22),
        inspection_state: "user_reported".into(),
        is_secondary_quotation: false,
        note: None,
    };
    assert!(matches!(validate_body(&body), Err(ApiError::BadRequest(_))));

    body.source_version_id = None;
    assert!(validate_body(&body).is_ok());

    body.passage_id = None;
    body.source_version_id = Some(0);
    assert!(matches!(validate_body(&body), Err(ApiError::BadRequest(_))));

    body.source_version_id = None;
    body.passage_id = Some(0);
    assert!(matches!(validate_body(&body), Err(ApiError::BadRequest(_))));

    body.passage_id = Some(22);
    body.introduced_kind = "concept".into();
    assert!(matches!(validate_body(&body), Err(ApiError::BadRequest(_))));
}

#[test]
fn decision_capture_rejects_authority_fields_and_invalid_claim_sets() {
    let request = json!({
        "companyId": 9,
        "sessionRef": "session-1",
        "eventRef": "event-1",
        "title": "Adopt policy",
        "adoptedClaimIds": [11],
        "rationale": "Reviewed against the cited policy.",
        "organizationId": 7,
    });
    assert!(serde_json::from_value::<CaptureDecisionBody>(request).is_err());

    let body = CaptureDecisionBody {
        company_id: 9,
        session_ref: "session-1".into(),
        turn_ref: None,
        event_ref: "event-1".into(),
        title: "Adopt policy".into(),
        adopted_claim_ids: vec![11, 11],
        supporting_claim_ids: vec![],
        applicability: vec![],
        alternatives: vec![],
        adaptations: vec![],
        assumptions: vec![],
        rationale: "Reviewed against the cited policy.".into(),
        supersedes_decision_id: None,
    };
    assert!(matches!(
        validate_decision_body(&body),
        Err(ApiError::BadRequest(_))
    ));
}

#[test]
fn component_confirmation_names_the_exact_content_reviewed() {
    assert!(is_content_hash(&"ab12".repeat(16)));
    for invalid in [
        "",
        "abc",
        &"AB12".repeat(16),
        &"zz12".repeat(16),
        &"a".repeat(65),
    ] {
        assert!(!is_content_hash(invalid), "{invalid}");
    }
    let request = json!({
        "companyId": 9, "kind": "component", "id": 11, "outcome": "confirmed",
        "note": "reviewed the edit", "expectedContentHash": "ab12".repeat(16),
    });
    let body: ReviewEvidenceBody = serde_json::from_value(request).expect("valid");
    assert_eq!(
        body.expected_content_hash.as_deref(),
        Some("ab12".repeat(16).as_str())
    );
}

#[test]
fn review_contract_rejects_actor_spoofing() {
    let request = json!({
        "companyId": 9,
        "kind": "decision",
        "id": 11,
        "outcome": "accepted",
        "note": null,
        "reviewerUid": "forged",
    });
    assert!(serde_json::from_value::<ReviewEvidenceBody>(request).is_err());
}

#[tokio::test]
async fn review_payload_transport_preserves_optional_notes_and_component_hashes() {
    use axum::{
        extract::State,
        http::{HeaderMap, StatusCode, Uri},
    };
    use std::sync::Mutex;
    use stdb_client::{ReducerCall, StdbClient};

    type Calls = Arc<Mutex<Vec<(String, String, Value)>>>;
    async fn receive(
        State(calls): State<Calls>,
        headers: HeaderMap,
        uri: Uri,
        Json(args): Json<Value>,
    ) -> StatusCode {
        calls.lock().unwrap().push((
            headers["authorization"].to_str().unwrap().to_owned(),
            uri.path().to_owned(),
            args,
        ));
        StatusCode::NO_CONTENT
    }
    let calls: Calls = Arc::new(Mutex::new(Vec::new()));
    let router = Router::new()
        .route(
            "/v1/database/review-fixture/call/review_ai_evidence_claim",
            post(receive),
        )
        .route(
            "/v1/database/review-fixture/call/review_ai_evidence_decision",
            post(receive),
        )
        .route(
            "/v1/database/review-fixture/call/review_ai_artifact_component_links",
            post(receive),
        )
        .with_state(calls.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let client = StdbClient::new(
        format!("http://{}", listener.local_addr().unwrap()),
        "review-fixture".into(),
        "human-reviewer-token".into(),
    );
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let hash = "ab12".repeat(16);
    let cases = [
        (
            "claim",
            "supported",
            Some("Checked the source"),
            None,
            "review_ai_evidence_claim",
            json!({"verification_outcome":"supported","verification_note":{"some":"Checked the source"}}),
        ),
        (
            "claim",
            "qualified",
            None,
            None,
            "review_ai_evidence_claim",
            json!({"verification_outcome":"qualified","verification_note":{"none":[]}}),
        ),
        (
            "decision",
            "accepted",
            Some("Checked the claims"),
            None,
            "review_ai_evidence_decision",
            json!({"outcome":"accepted","note":{"some":"Checked the claims"}}),
        ),
        (
            "decision",
            "rejected",
            None,
            None,
            "review_ai_evidence_decision",
            json!({"outcome":"rejected","note":{"none":[]}}),
        ),
        (
            "component",
            "confirmed",
            Some("Checked this edit"),
            Some(hash.as_str()),
            "review_ai_artifact_component_links",
            json!({"outcome":"confirmed","note":{"some":"Checked this edit"},"expected_content_hash":{"some":hash}}),
        ),
        (
            "component",
            "unresolved",
            None,
            None,
            "review_ai_artifact_component_links",
            json!({"outcome":"unresolved","note":{"none":[]},"expected_content_hash":{"none":[]}}),
        ),
    ];
    for (kind, outcome, note, expected_hash, expected_reducer, expected_params) in cases {
        let body: ReviewEvidenceBody = serde_json::from_value(json!({"companyId":9,"kind":kind,"id":11,"outcome":outcome,"note":note,"expectedContentHash":expected_hash})).unwrap();
        let (reducer, params) = review_evidence_payload(&body).unwrap();
        assert_eq!(reducer, expected_reducer);
        client
            .call_reducer(ReducerCall::from_name(reducer, json!([7, 9, body.id, params])).unwrap())
            .await
            .unwrap();
        let (authorization, path, wire) = calls.lock().unwrap().pop().expect("native request");
        assert_eq!(authorization, "Bearer human-reviewer-token");
        assert_eq!(
            path,
            format!("/v1/database/review-fixture/call/{expected_reducer}")
        );
        assert_eq!(wire, json!([7, 9, 11, expected_params]));
    }
    server.abort();
}

#[test]
fn review_payload_keeps_exact_component_hash_and_target_admission() {
    let mut body = ReviewEvidenceBody {
        company_id: 9,
        kind: "component".into(),
        id: 11,
        outcome: "confirmed".into(),
        note: None,
        expected_content_hash: None,
    };
    assert!(review_evidence_payload(&body).is_err());
    body.expected_content_hash = Some("not-a-hash".into());
    assert!(review_evidence_payload(&body).is_err());
    body.expected_content_hash = Some("ab12".repeat(16));
    assert!(review_evidence_payload(&body).is_ok());
    body.kind = "decision".into();
    body.outcome = "accepted".into();
    assert!(review_evidence_payload(&body).is_err());
    body.expected_content_hash = None;
    assert!(review_evidence_payload(&body).is_ok());
    body.company_id = 0;
    assert!(review_evidence_payload(&body).is_err());
}
