//! Browser and native transport for a durably backed local-runner dispatcher.

use std::{convert::Infallible, sync::Arc, time::Duration};

use ai_gateway::local_runner::{Decision, EventFrame, PROTOCOL_VERSION};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, Path, Query,
    },
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Extension, Json, Router,
};
use futures::stream;
use lumiere_auth_context::ActorContext;
use reqwest::Url;
use serde::Deserialize;
use serde_json::Value;
use tokio::time::{self, Instant};

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

use super::{
    local_runner::{disabled_discovery, DevicesQuery},
    runner_dispatch::{
        acknowledgement, parse_run_id, DeviceCredential, PairingResponse, Provider, ProviderStatus,
        Replay, RunnerDispatch, StartRequest,
    },
    runner_mcp,
    runner_storage::StdbRunnerStore,
};

const MAX_DEVICE_FRAME: usize = 256 * 1024;
const MAX_BROWSER_BODY: usize = 24 * 1024;
const AUTHORIZATION_INTERVAL: Duration = Duration::from_secs(5);
const POLL_INTERVAL: Duration = Duration::from_secs(1);

pub(crate) struct RunnerRouters {
    pub(crate) browser: Router<AppState>,
    pub(crate) native: Router<AppState>,
}

pub(crate) fn routers_from_config(state: &AppState) -> RunnerRouters {
    let disabled = || RunnerRouters {
        browser: Router::new().route(
            "/v1/internal/local-runner/devices",
            get(super::local_runner::get_devices),
        ),
        native: Router::new(),
    };
    let Ok(origin) = std::env::var("LUMIERE_AI_LOCAL_RUNNER_ORIGIN") else {
        return disabled();
    };
    let configured = || {
        let origin = Url::parse(&origin).ok()?;
        let pilot_company_id = std::env::var("LUMIERE_AI_LOCAL_RUNNER_PILOT_COMPANY_ID")
            .ok()?
            .parse::<u64>()
            .ok()?;
        let token = std::env::var("LUMIERE_AI_LOCAL_RUNNER_STDB_TOKEN").ok()?;
        if token.trim().is_empty()
            || token == state.config.stdb_token
            || state.config.ai_spend_read_stdb_token.as_deref() == Some(token.as_str())
            || state.config.ai_certification_stdb_token.as_deref() == Some(token.as_str())
        {
            return None;
        }
        let client = state.stdb.with_token(token);
        let store = Arc::new(StdbRunnerStore::new(&client).ok()?);
        let dispatch = Arc::new(
            RunnerDispatch::new(
                state.clone(),
                store,
                origin,
                Provider::Codex,
                pilot_company_id,
            )
            .ok()?,
        );
        Some(RunnerRouters {
            browser: browser_router(dispatch.clone()),
            native: device_router(dispatch.clone()).merge(runner_mcp::router(dispatch)),
        })
    };
    configured().unwrap_or_else(|| {
        tracing::warn!("Local runner is disabled pending its durable runtime configuration");
        disabled()
    })
}

/// The deployment mounts this router behind the trusted BFF gateway secret.
pub(super) fn browser_router(dispatch: Arc<RunnerDispatch>) -> Router<AppState> {
    Router::new()
        .route("/v1/internal/local-runner/devices", get(devices))
        .route("/v1/internal/local-runner/pair", post(issue_pairing))
        .route("/v1/internal/local-runner/devices/revoke", post(revoke))
        .route("/v1/internal/local-runner/runs", post(start))
        .route("/v1/internal/local-runner/runs/:id/events", get(events))
        .route("/v1/internal/local-runner/runs/:id/cancel", post(cancel))
        .route(
            "/v1/internal/local-runner/runs/:id/permission",
            post(permission),
        )
        .layer(DefaultBodyLimit::max(MAX_BROWSER_BODY))
        .layer(Extension(dispatch))
}

/// The deployment mounts this router without browser CORS or BFF-secret auth.
/// Native pairing uses a one-time code. Sockets use their device credential.
pub(super) fn device_router(dispatch: Arc<RunnerDispatch>) -> Router<AppState> {
    Router::new()
        .route("/v1/local-runner/pair/claim", post(claim_pairing))
        .route("/v1/local-runner/device", get(device))
        .layer(DefaultBodyLimit::max(1024))
        .layer(Extension(dispatch))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Company {
    company_id: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Revoke {
    company_id: u64,
    device_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Claim {
    code: String,
    label: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Cursor {
    company_id: u64,
    #[serde(default)]
    after: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Permission {
    company_id: u64,
    permission_id: String,
    decision: Decision,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Handshake {
    Hello {
        version: u8,
        providers: Vec<ProviderStatus>,
    },
}

fn actor(headers: &HeaderMap, company_id: u64) -> AppResult<ActorContext> {
    let actor = ActorContext::from_headers(headers)?;
    actor.require_company(company_id)?;
    Ok(actor)
}

fn private(response: impl IntoResponse) -> Response {
    let mut response = response.into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    response
}

async fn devices(
    Extension(dispatch): Extension<Arc<RunnerDispatch>>,
    headers: HeaderMap,
    Query(query): Query<DevicesQuery>,
    axum::extract::State(state): axum::extract::State<AppState>,
) -> AppResult<Response> {
    let actor = actor(&headers, query.company_id)?;
    if !dispatch.admits_company(query.company_id) {
        return disabled_discovery(&state, &actor).await;
    }
    dispatch
        .devices(&actor)
        .await
        .map(|response| private(Json(response)))
}

async fn issue_pairing(
    Extension(dispatch): Extension<Arc<RunnerDispatch>>,
    headers: HeaderMap,
    Json(request): Json<Company>,
) -> AppResult<Response> {
    let paired: PairingResponse = dispatch
        .issue_pairing(&actor(&headers, request.company_id)?)
        .await?;
    Ok(private(Json(paired)))
}

async fn revoke(
    Extension(dispatch): Extension<Arc<RunnerDispatch>>,
    headers: HeaderMap,
    Json(request): Json<Revoke>,
) -> AppResult<StatusCode> {
    dispatch
        .revoke(&actor(&headers, request.company_id)?, &request.device_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn start(
    Extension(dispatch): Extension<Arc<RunnerDispatch>>,
    headers: HeaderMap,
    Json(request): Json<StartRequest>,
) -> AppResult<Response> {
    let identity = dispatch
        .start(&actor(&headers, request.company_id)?, request)
        .await?;
    Ok(private(Json(identity)))
}

async fn cancel(
    Extension(dispatch): Extension<Arc<RunnerDispatch>>,
    headers: HeaderMap,
    Path(run): Path<String>,
    Json(request): Json<Company>,
) -> AppResult<StatusCode> {
    dispatch
        .cancel(&actor(&headers, request.company_id)?, parse_run_id(&run)?)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn permission(
    Extension(dispatch): Extension<Arc<RunnerDispatch>>,
    headers: HeaderMap,
    Path(run): Path<String>,
    Json(request): Json<Permission>,
) -> AppResult<StatusCode> {
    dispatch
        .permission(
            &actor(&headers, request.company_id)?,
            parse_run_id(&run)?,
            &request.permission_id,
            request.decision,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn events(
    Extension(dispatch): Extension<Arc<RunnerDispatch>>,
    headers: HeaderMap,
    Path(run): Path<String>,
    Query(query): Query<Cursor>,
) -> AppResult<Response> {
    let actor = actor(&headers, query.company_id)?;
    let run_id = parse_run_id(&run)?;
    let replay = dispatch.replay(&actor, run_id, query.after, true).await?;
    if replay.verifying {
        dispatch.schedule_verification(run_id);
    }
    let cursor = EventCursor {
        actor,
        dispatch,
        run_id,
        after: query.after,
        events: replay.events.into_iter(),
        terminal: replay.terminal,
        authorize_at: Instant::now() + AUTHORIZATION_INTERVAL,
    };
    let stream = stream::unfold(cursor, next_event);
    let mut response = private(Sse::new(stream).keep_alive(KeepAlive::default()));
    response
        .headers_mut()
        .insert("x-accel-buffering", HeaderValue::from_static("no"));
    Ok(response)
}

struct EventCursor {
    actor: ActorContext,
    dispatch: Arc<RunnerDispatch>,
    run_id: u64,
    after: usize,
    events: std::vec::IntoIter<Value>,
    terminal: bool,
    authorize_at: Instant,
}

async fn next_event(mut cursor: EventCursor) -> Option<(Result<Event, Infallible>, EventCursor)> {
    loop {
        if let Some(event) = cursor.events.next() {
            cursor.after += 1;
            return Some((Ok(Event::default().data(event.to_string())), cursor));
        }
        if cursor.terminal {
            return None;
        }
        time::sleep(POLL_INTERVAL).await;
        let refresh = Instant::now() >= cursor.authorize_at;
        let Replay {
            events,
            terminal,
            verifying,
        } = cursor
            .dispatch
            .replay(&cursor.actor, cursor.run_id, cursor.after, refresh)
            .await
            .ok()?;
        cursor.events = events.into_iter();
        cursor.terminal = terminal;
        if refresh {
            cursor.authorize_at = Instant::now() + AUTHORIZATION_INTERVAL;
            if verifying {
                cursor.dispatch.schedule_verification(cursor.run_id);
            }
        }
    }
}

async fn claim_pairing(
    Extension(dispatch): Extension<Arc<RunnerDispatch>>,
    headers: HeaderMap,
    Json(request): Json<Claim>,
) -> AppResult<Response> {
    require_native(&headers)?;
    let paired: DeviceCredential = dispatch
        .claim_pairing(&request.code, request.label.as_deref())
        .await?;
    Ok(private((StatusCode::CREATED, Json(paired))))
}

async fn device(
    Extension(dispatch): Extension<Arc<RunnerDispatch>>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> AppResult<Response> {
    require_native(&headers)?;
    let device_id = header_value(&headers, "x-lumiere-runner-device-id")?;
    let credential = header_value(&headers, header::AUTHORIZATION.as_str())?
        .strip_prefix("Bearer ")
        .ok_or_else(denied)?;
    let device = dispatch.authenticate_device(device_id, credential).await?;
    Ok(upgrade
        .max_message_size(MAX_DEVICE_FRAME)
        .max_frame_size(MAX_DEVICE_FRAME)
        .on_upgrade(move |socket| handle_device(dispatch, socket, device)))
}

fn require_native(headers: &HeaderMap) -> AppResult<()> {
    if headers.contains_key(header::ORIGIN) {
        return Err(denied());
    }
    Ok(())
}

fn header_value<'a>(headers: &'a HeaderMap, name: &str) -> AppResult<&'a str> {
    let mut values = headers.get_all(name).iter();
    let value = values
        .next()
        .and_then(|value| value.to_str().ok())
        .ok_or_else(denied)?;
    if values.next().is_some() {
        return Err(denied());
    }
    Ok(value)
}

fn denied() -> AppError {
    AppError::Forbidden("runner device access is unauthorized".into())
}

async fn handle_device(
    dispatch: Arc<RunnerDispatch>,
    mut socket: WebSocket,
    device: super::runner_storage::StoredDevice,
) {
    let Ok(Some(Ok(Message::Text(message)))) =
        time::timeout(Duration::from_secs(10), socket.recv()).await
    else {
        return;
    };
    let Ok(Handshake::Hello { version, providers }) = serde_json::from_str(&message) else {
        return;
    };
    if version != PROTOCOL_VERSION {
        return;
    }
    let Ok((connection, mut outbound)) = dispatch.connect(&device, providers).await else {
        return;
    };
    let mut heartbeat = time::interval(Duration::from_secs(15));
    loop {
        tokio::select! {
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                    Some(Ok(Message::Text(message))) => {
                        let Ok(frame) = serde_json::from_str::<EventFrame>(&message) else {
                            break;
                        };
                        let Ok(run_id) = parse_run_id(&frame.run_id) else {
                            break;
                        };
                        if dispatch.ingest(&device, connection, frame.clone()).await.is_err() {
                            break;
                        }
                        if matches!(frame.event, ai_gateway::local_runner::RunnerEvent::Candidate { .. }) {
                            dispatch.schedule_verification(run_id);
                        }
                        if socket.send(Message::Text(acknowledgement(&frame).to_string())).await.is_err() {
                            break;
                        }
                    }
                    _ => break,
                }
            }
            message = outbound.recv() => {
                let Some(message) = message else {
                    break;
                };
                if !dispatch.is_current_connection(&device.device_id, connection)
                    || socket.send(Message::Text(message.to_string())).await.is_err()
                {
                    break;
                }
            }
            _ = heartbeat.tick() => {
                if !dispatch.is_current_connection(&device.device_id, connection)
                    || socket.send(Message::Ping(Vec::new())).await.is_err()
                {
                    break;
                }
            }
        }
    }
    dispatch.disconnect(&device.device_id, connection);
}
