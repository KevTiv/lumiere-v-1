use ai_gateway::local_runner::EventFrameType;
use axum::{http::StatusCode, Router};
use std::sync::atomic::Ordering;

use crate::routes::{
    runner_inventory::tests::{inventory_fixture, inventory_fixture_with_stock_failures},
    runner_mcp,
    runner_storage::test_support::MemoryRunnerStore,
    runner_transport,
};

use super::*;

fn start_request(device_id: &str, request_id: &str) -> StartRequest {
    StartRequest {
        company_id: 9,
        device_id: device_id.into(),
        conversation_id: "chat".into(),
        request_id: request_id.into(),
        provider: Provider::Codex,
        prompt: "Find low stock.".into(),
        org_privacy_policy: OrgPrivacyPolicy::default(),
    }
}

fn provider() -> ProviderStatus {
    ProviderStatus {
        provider: Provider::Codex,
        state: ProviderState::Ready,
        capabilities: vec![Capability::Mcp],
        version: None,
        funding: None,
    }
}

fn frame(id: &AttemptId, seq: u64, event: RunnerEvent) -> EventFrame {
    EventFrame {
        frame_type: EventFrameType::Event,
        run_id: id.run_id.clone(),
        attempt_id: id.attempt_id.clone(),
        lease_id: id.lease_id.clone(),
        seq,
        event,
    }
}

async fn serve(app: Router) -> (Url, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (origin, task)
}

#[tokio::test]
async fn runner_recovers_a_durable_attempt_and_publishes_only_verifiable_inventory() {
    let (state, (_, inventory_reads), inventory) = inventory_fixture().await;
    let owner_actor = ActorContext::new(&"a".repeat(64), "test-session", 7, 9).unwrap();
    let store = Arc::new(MemoryRunnerStore::default());
    let origin = Url::parse("https://runner.example.com").unwrap();
    let dispatcher = Arc::new(
        RunnerDispatch::new(
            state.clone(),
            store.clone(),
            origin.clone(),
            Provider::Codex,
            9,
        )
        .unwrap(),
    );
    let pairing = dispatcher.issue_pairing(&owner_actor).await.unwrap();
    let device_credential = dispatcher
        .claim_pairing(&pairing.code, Some("Mac"))
        .await
        .unwrap();
    assert!(dispatcher
        .claim_pairing(&pairing.code, Some("Duplicate"))
        .await
        .is_err());
    let device = dispatcher
        .authenticate_device(&device_credential.device_id, &device_credential.credential)
        .await
        .unwrap();
    let (connection, mut messages) = dispatcher.connect(&device, vec![provider()]).await.unwrap();

    let id = dispatcher
        .start(&owner_actor, start_request(&device.device_id, "turn"))
        .await
        .unwrap();
    let dispatch = messages.recv().await.unwrap();
    assert_eq!(dispatch["type"], "dispatch");
    assert_eq!(dispatch["attemptId"], id.attempt_id);
    assert_eq!(
        dispatch["mcp"]["url"],
        "https://runner.example.com/v1/local-runner/mcp"
    );
    assert!(dispatch["prompt"].as_str().unwrap().contains("evidenceId"));
    let token = dispatch["mcp"]["token"].as_str().unwrap();
    let run_id = parse_run_id(&id.run_id).unwrap();
    assert_eq!(
        dispatcher
            .start(&owner_actor, start_request(&device.device_id, "turn"))
            .await
            .unwrap(),
        id
    );
    assert!(messages.try_recv().is_err());
    assert!(dispatcher
        .start(&owner_actor, start_request(&device.device_id, "other-turn"))
        .await
        .is_err());
    let stored = store.run(run_id).await.unwrap().unwrap();
    assert!(!stored.payload.contains(token));
    assert!(!stored.payload.contains(&device_credential.credential));
    assert!(!stored.payload.contains(&owner_actor.token));
    assert!(!stored.payload.contains("Find low stock."));

    let (mcp, mcp_task) =
        serve(runner_mcp::router(dispatcher.clone()).with_state(state.clone())).await;
    let response = reqwest::Client::new()
        .post(mcp.join(MCP_PATH).unwrap())
        .bearer_auth(token)
        .header("accept", "application/json, text/event-stream")
        .json(&json!({
            "jsonrpc": "2.0", "id": 7, "method": "tools/call",
            "params": {"name": INVENTORY_LOW_STOCK_TOOL, "arguments": {"threshold": 5, "location_id": 8}},
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let reply: Value = response.json().await.unwrap();
    let reference = reply["result"]["structuredContent"]["evidenceId"]
        .as_str()
        .unwrap();
    let event = frame(
        &id,
        1,
        RunnerEvent::Candidate {
            text: json!({ "evidenceId": reference, "productIds": ["42"] }).to_string(),
        },
    );
    assert_eq!(
        dispatcher
            .ingest(&device, connection, event.clone())
            .await
            .unwrap(),
        Apply::Applied
    );
    assert_eq!(
        dispatcher.ingest(&device, connection, event).await.unwrap(),
        Apply::Replayed
    );
    let before = dispatcher
        .replay(&owner_actor, run_id, 0, true)
        .await
        .unwrap();
    assert!(!before.terminal);
    assert_eq!(before.events.len(), 1);
    assert!(!before.events[0].to_string().contains(reference));
    assert!(dispatcher.authorize(token).await.is_err());

    let recovering = Arc::new(
        RunnerDispatch::new(state.clone(), store.clone(), origin, Provider::Codex, 9).unwrap(),
    );
    assert!(recovering.verify_candidate(run_id).await.is_err());
    let other = ActorContext::new(&owner_actor.identity, "test-session", 7, 10).unwrap();
    assert!(recovering.replay(&other, run_id, 0, true).await.is_err());
    recovering
        .replay(&owner_actor, run_id, 1, true)
        .await
        .unwrap();
    recovering.verify_candidate(run_id).await.unwrap();
    recovering.verify_candidate(run_id).await.unwrap();
    let after = recovering
        .replay(&owner_actor, run_id, 1, true)
        .await
        .unwrap();
    assert!(after.terminal);
    assert_eq!(after.events.len(), 1);
    let verified = &after.events[0];
    assert_eq!(verified["seq"], 2);
    assert_eq!(verified["type"], "verified");
    assert_eq!(verified["run_id"], run_id);
    assert_eq!(verified["evidence_id"], reference);
    assert_eq!(verified["sources"][0]["entity_id"], "42");
    assert_eq!(verified["sources"][0]["kind"], "live");
    assert_eq!(verified["sources"][0]["trust"], "authoritative");
    assert!(verified["answer"].as_str().unwrap().contains("3 on hand"));
    assert_eq!(inventory_reads.load(Ordering::Relaxed), 6);

    let (browser, browser_task) =
        serve(runner_transport::browser_router(recovering).with_state(state)).await;
    let response = reqwest::Client::new()
        .get(
            browser
                .join(&format!(
                    "/v1/internal/local-runner/runs/{run_id}/events?companyId=9&after=1"
                ))
                .unwrap(),
        )
        .headers(owner_actor.headers().unwrap())
        .header("accept", "text/event-stream")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers()["content-type"]
        .to_str()
        .unwrap()
        .starts_with("text/event-stream"));
    let stream = response.text().await.unwrap();
    let replayed: Value = serde_json::from_str(
        stream
            .lines()
            .find_map(|line| line.strip_prefix("data: "))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(replayed, *verified);
    browser_task.abort();
    mcp_task.abort();
    inventory.abort();
}

#[tokio::test]
async fn runner_revocation_and_cancellation_invalidate_existing_tool_auth_and_prevent_publication()
{
    let (state, (membership_revoked, _), inventory) = inventory_fixture().await;
    let actor = ActorContext::new(&"a".repeat(64), "test-session", 7, 9).unwrap();
    let store = Arc::new(MemoryRunnerStore::default());
    let dispatcher = RunnerDispatch::new(
        state,
        store,
        Url::parse("https://runner.example.com").unwrap(),
        Provider::Codex,
        9,
    )
    .unwrap();
    let code = dispatcher.issue_pairing(&actor).await.unwrap().code;
    let device = dispatcher.claim_pairing(&code, None).await.unwrap();
    let device = dispatcher
        .authenticate_device(&device.device_id, &device.credential)
        .await
        .unwrap();
    let (connection_id, mut messages) =
        dispatcher.connect(&device, vec![provider()]).await.unwrap();
    let run = dispatcher
        .start(&actor, start_request(&device.device_id, "first"))
        .await
        .unwrap();
    let first = messages.recv().await.unwrap();
    let run_id = parse_run_id(&run.run_id).unwrap();
    let bearer = first["mcp"]["token"].as_str().unwrap();
    assert!(dispatcher.authorize(bearer).await.is_ok());
    membership_revoked.store(true, Ordering::Relaxed);
    assert!(matches!(
        dispatcher.authorize(bearer).await,
        Err(AppError::Forbidden(_))
    ));
    membership_revoked.store(false, Ordering::Relaxed);

    dispatcher.cancel(&actor, run_id).await.unwrap();
    assert!(dispatcher.authorize(bearer).await.is_err());
    assert_eq!(messages.recv().await.unwrap()["type"], "cancel");
    dispatcher
        .ingest(
            &device,
            connection_id,
            frame(&run, 1, RunnerEvent::Candidate { text: "{}".into() }),
        )
        .await
        .unwrap();
    dispatcher.verify_candidate(run_id).await.unwrap();
    let replay = dispatcher.replay(&actor, run_id, 1, true).await.unwrap();
    assert!(replay.terminal);
    assert_eq!(replay.events[0]["code"], "candidate_withheld");

    dispatcher
        .start(&actor, start_request(&device.device_id, "second"))
        .await
        .unwrap();
    let next = messages.recv().await.unwrap();
    let bearer = next["mcp"]["token"].as_str().unwrap();
    assert!(dispatcher.authorize(bearer).await.is_ok());
    dispatcher.revoke(&actor, &device.device_id).await.unwrap();
    assert!(!dispatcher.is_current_connection(&device.device_id, connection_id));
    assert!(dispatcher.authorize(bearer).await.is_err());
    inventory.abort();
}

#[tokio::test]
async fn browser_and_native_routes_share_one_verified_attempt() {
    use futures::{SinkExt, StreamExt};
    use std::time::Duration;
    use tokio_tungstenite::{
        connect_async,
        tungstenite::{client::IntoClientRequest, Message},
    };

    let stock_failures = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let (state, (_, _), inventory) =
        inventory_fixture_with_stock_failures(stock_failures.clone()).await;
    let actor = ActorContext::new(&"a".repeat(64), "test-session", 7, 9).unwrap();
    let store = Arc::new(MemoryRunnerStore::default());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
    let dispatcher = Arc::new(
        RunnerDispatch::new(state.clone(), store, origin.clone(), Provider::Codex, 9).unwrap(),
    );
    let app = runner_transport::browser_router(dispatcher.clone())
        .merge(runner_transport::device_router(dispatcher.clone()))
        .merge(runner_mcp::router(dispatcher.clone()))
        .with_state(state);
    let gateway = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    let browser_post = |path: &str, body: Value| {
        client
            .post(origin.join(path).unwrap())
            .headers(actor.headers().unwrap())
            .json(&body)
    };
    let offer: Value = browser_post("/v1/internal/local-runner/pair", json!({"companyId": 9}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let device: Value = client
        .post(origin.join("/v1/local-runner/pair/claim").unwrap())
        .json(&json!({"code": offer["code"], "label": "Fixture"}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let device_id = device["deviceId"].as_str().unwrap();
    let mut socket_url = origin.join("/v1/local-runner/device").unwrap();
    socket_url.set_scheme("ws").unwrap();
    let mut request = socket_url.as_str().into_client_request().unwrap();
    request.headers_mut().insert(
        "authorization",
        format!("Bearer {}", device["credential"].as_str().unwrap())
            .parse()
            .unwrap(),
    );
    request
        .headers_mut()
        .insert("x-lumiere-runner-device-id", device_id.parse().unwrap());
    let (mut socket, _) = connect_async(request).await.unwrap();
    socket
        .send(Message::Text(
            json!({
                "type": "hello", "version": PROTOCOL_VERSION, "providers": [provider()]
            })
            .to_string(),
        ))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let discovery: Value = client
                .get(
                    origin
                        .join("/v1/internal/local-runner/devices?companyId=9")
                        .unwrap(),
                )
                .headers(actor.headers().unwrap())
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .json()
                .await
                .unwrap();
            if discovery["devices"][0]["state"] == "online" {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();

    let started: AttemptId = browser_post(
        "/v1/internal/local-runner/runs",
        json!({
            "companyId": 9, "conversationId": "chat", "requestId": "turn", "provider": "codex",
            "prompt": "Which products are low in stock?", "deviceId": device_id,
            "orgPrivacyPolicy": OrgPrivacyPolicy::default()
        }),
    )
    .send()
    .await
    .unwrap()
    .error_for_status()
    .unwrap()
    .json()
    .await
    .unwrap();
    let message = tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(Ok(message)) = socket.next().await {
            if let Message::Text(message) = message {
                return message;
            }
        }
        panic!("native runner did not receive a dispatch");
    })
    .await
    .unwrap();
    let dispatch: Value = serde_json::from_str(&message).unwrap();
    assert_eq!(dispatch["runId"], started.run_id);
    let evidence: Value = client.post(dispatch["mcp"]["url"].as_str().unwrap())
        .header("accept", "application/json, text/event-stream")
        .bearer_auth(dispatch["mcp"]["token"].as_str().unwrap())
        .json(&json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": INVENTORY_LOW_STOCK_TOOL, "arguments": {"threshold": 5, "location_id": 8}}
        })).send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    let candidate = frame(
        &started,
        1,
        RunnerEvent::Candidate {
            text: json!({
                "evidenceId": evidence["result"]["structuredContent"]["evidenceId"],
                "productIds": ["42"]
            })
            .to_string(),
        },
    );
    stock_failures.store(usize::MAX, Ordering::Relaxed);
    socket
        .send(Message::Text(serde_json::to_string(&candidate).unwrap()))
        .await
        .unwrap();
    let ack = tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(Ok(message)) = socket.next().await {
            if let Message::Text(message) = message {
                return message;
            }
        }
        panic!("native runner did not receive an acknowledgement");
    })
    .await
    .unwrap();
    let ack: Value = serde_json::from_str(&ack).unwrap();
    assert_eq!(ack["attemptId"], started.attempt_id);
    assert_eq!(ack["seq"], 1);

    let response = client
        .get(
            origin
                .join(&format!(
                    "/v1/internal/local-runner/runs/{}/events?companyId=9&after=0",
                    started.run_id
                ))
                .unwrap(),
        )
        .headers(actor.headers().unwrap())
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    // The native verification failed while this same browser stream is still
    // connected. Restore stock reads and let the polling recheck complete it.
    let run_id = parse_run_id(&started.run_id).unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        while stock_failures.load(Ordering::Relaxed) == usize::MAX
            || dispatcher.verifications.contains(&run_id)
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    stock_failures.store(0, Ordering::Relaxed);
    let response = response.text().await.unwrap();
    let event: Value = serde_json::from_str(
        response
            .lines()
            .filter_map(|line| line.strip_prefix("data: "))
            .last()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(event["type"], "verified");
    assert_eq!(
        event["evidence_id"],
        evidence["result"]["structuredContent"]["evidenceId"]
    );
    assert_eq!(event["sources"][0]["entity_id"], "42");
    gateway.abort();
    inventory.abort();
}
