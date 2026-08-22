//! Axum router and `serve` — shared by `lib` and the `api-server` binary.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::{
        header::{HeaderName, ACCEPT, ACCEPT_LANGUAGE, AUTHORIZATION, CONTENT_TYPE, COOKIE},
        HeaderMap, Method, StatusCode,
    },
    middleware::from_fn,
    routing::{get, post},
    Json, Router,
};

use crate::realtime;
use serde::Deserialize;
use serde_json::{json, Value};
use tower_cookies::CookieManagerLayer;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::Config;
use crate::error::ApiError;
use crate::metrics;
use crate::middleware::metrics::track_http_metrics;
use crate::query_exec::{default_company_id, execute_resource_query_for_company};
use crate::routes;
use crate::session::resolve_api_session;
use crate::state::AppState;
use crate::web_session::stdb_identity_hex_hint;
use stdb_client::{Exposure, ReducerCall, ReducerContract};

#[derive(Debug, Deserialize)]
struct OrgQuery {
    #[serde(rename = "organizationId")]
    organization_id: Option<u64>,
    #[serde(rename = "companyId")]
    company_id: Option<u64>,
    /// Keyset cursor for paginated resources (currently only "pos-orders");
    /// other resources ignore it.
    cursor: Option<String>,
    /// Page size for paginated resources; other resources ignore it.
    limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct CallQuery {
    #[serde(default, rename = "withCompany")]
    with_company: bool,
}

async fn health() -> StatusCode {
    StatusCode::OK
}

async fn health_ready(State(state): State<Arc<AppState>>) -> Result<StatusCode, StatusCode> {
    let token = state
        .config
        .stdb_server_token
        .as_deref()
        .filter(|t| !t.is_empty())
        .unwrap_or("");
    let client = state.client_with_token(token);
    if client.query_sql("SELECT 1").await.is_err() {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    if !state.config.ai_gateway_url.is_empty() {
        let url = format!(
            "{}/health",
            state.config.ai_gateway_url.trim_end_matches('/')
        );
        if let Ok(resp) = state.http.get(&url).send().await {
            if !resp.status().is_success() {
                return Err(StatusCode::SERVICE_UNAVAILABLE);
            }
        }
    }
    Ok(StatusCode::OK)
}

async fn metrics_handler() -> (StatusCode, String) {
    (StatusCode::OK, metrics::render_prometheus())
}

async fn get_query(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
    Path(resource): Path<String>,
    Query(q): Query<OrgQuery>,
) -> Result<Json<Value>, ApiError> {
    let auth = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok());
    let id_hint = stdb_identity_hex_hint(&headers, &cookies);
    let cookie_tok = cookies.get("stdb_token").map(|c| c.value().to_string());

    let session = resolve_api_session(&state, auth, cookie_tok.as_deref(), id_hint.as_deref())
        .await?
        .ok_or(ApiError::Unauthorized)?;

    let org_id = session
        .organization_id
        .ok_or_else(|| ApiError::Forbidden("No organization assigned".into()))?;
    if let Some(override_org) = q.organization_id {
        if override_org != org_id {
            return Err(ApiError::Forbidden(
                "Cannot query another organization's data".into(),
            ));
        }
    }

    // Private workflow tables are not readable with the user JWT; use the module
    // owner token and enforce identity/company filters in `workflow_reads`.
    let client = if crate::workflow_reads::is_private_workflow_resource(&resource)
        || crate::query_exec::crm_resource(&resource)
    {
        state.stdb.clone()
    } else {
        state.client_with_token(&session.stdb_token)
    };
    // "pos-orders" is cursor-paginated (hot+cold merge) and needs a response
    // envelope beyond the generic `{"data": [...]}` — special-cased here
    // rather than folded into `execute_resource_query_for_company`, whose
    // signature is shared by ~40 resources that don't need a cursor.
    if resource == "pos-orders" {
        let page = crate::cold_tier::pos_order_read::merged_page(
            &client,
            org_id,
            q.company_id,
            q.cursor.clone(),
            q.limit,
        )
        .await?;
        return Ok(Json(
            json!({ "data": page.rows, "nextCursor": page.next_cursor }),
        ));
    }

    let data = execute_resource_query_for_company(
        &client,
        &resource,
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
        q.company_id,
    )
    .await?;

    Ok(Json(json!({ "data": data })))
}

async fn post_call(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
    Path(reducer): Path<String>,
    Query(q): Query<CallQuery>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let auth = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok());
    let id_hint = stdb_identity_hex_hint(&headers, &cookies);
    let cookie_tok = cookies.get("stdb_token").map(|c| c.value().to_string());

    let session = resolve_api_session(&state, auth, cookie_tok.as_deref(), id_hint.as_deref())
        .await?
        .ok_or(ApiError::Unauthorized)?;

    let org_id = session
        .organization_id
        .ok_or_else(|| ApiError::Forbidden("No organization assigned".into()))?;

    let contract = session_reducer_contract(&reducer)?;

    let named_input = body.is_object();
    let mut args: Vec<Value> = if let Some(arguments) = body.as_array() {
        arguments.clone()
    } else if named_input {
        named_command_args(contract, body, org_id)?
    } else {
        return Err(ApiError::Unprocessable(
            "Reducer body must be a named object or legacy argument array".into(),
        ));
    };

    if q.with_company {
        if named_input {
            return Err(ApiError::Unprocessable(
                "withCompany is only supported by the legacy positional call format".into(),
            ));
        }
        let client = state.client_with_token(&session.stdb_token);
        let company_id = default_company_id(&client, org_id)
            .await?
            .ok_or_else(|| ApiError::Unprocessable("No company found for organization".into()))?;
        let mut next = vec![json!(org_id), json!(company_id)];
        next.append(&mut args);
        args = next;
    }

    execute_reducer_call(&state, &session.stdb_token, contract, args, org_id).await
}

fn session_reducer_contract(reducer: &str) -> Result<&'static ReducerContract, ApiError> {
    let contract = stdb_client::reducer_contract(reducer).ok_or_else(|| {
        ApiError::Forbidden(format!(
            "Reducer '{reducer}' is not exposed by the module contract"
        ))
    })?;
    if contract.exposure != Exposure::Session {
        return Err(ApiError::Forbidden(format!(
            "Reducer '{reducer}' is not session-exposed"
        )));
    }
    Ok(contract)
}

fn named_command_args(
    contract: &'static ReducerContract,
    body: Value,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let mut fields = body
        .as_object()
        .cloned()
        .ok_or_else(|| ApiError::Unprocessable("Command body must be a JSON object".into()))?;
    let mut args = Vec::with_capacity(contract.params.len());

    for (position, parameter) in contract.params.iter().enumerate() {
        if Some(position) == contract.organization_position {
            args.push(json!(organization_id));
            continue;
        }
        let camel_name = snake_to_lower_camel(parameter.name);
        let snake_value = fields.remove(parameter.name);
        let camel_value = (camel_name != parameter.name)
            .then(|| fields.remove(&camel_name))
            .flatten();
        if snake_value.is_some() && camel_value.is_some() {
            return Err(ApiError::Unprocessable(format!(
                "Reducer '{}' received both '{}' and '{}'",
                contract.name, parameter.name, camel_name
            )));
        }
        let value = snake_value.or(camel_value).ok_or_else(|| {
            ApiError::Unprocessable(format!(
                "Reducer '{}' requires named field '{}'",
                contract.name, camel_name
            ))
        })?;
        args.push(value);
    }

    if !fields.is_empty() {
        let mut names: Vec<_> = fields.keys().cloned().collect();
        names.sort();
        return Err(ApiError::Unprocessable(format!(
            "Reducer '{}' received unknown or server-owned fields: {}",
            contract.name,
            names.join(", ")
        )));
    }
    Ok(args)
}

fn snake_to_lower_camel(name: &str) -> String {
    let mut result = String::with_capacity(name.len());
    let mut uppercase_next = false;
    for character in name.chars() {
        if character == '_' {
            uppercase_next = true;
        } else if uppercase_next {
            result.extend(character.to_uppercase());
            uppercase_next = false;
        } else {
            result.push(character);
        }
    }
    result
}

async fn execute_reducer_call(
    state: &AppState,
    stdb_token: &str,
    contract: &'static ReducerContract,
    args: Vec<Value>,
    organization_id: u64,
) -> Result<Json<Value>, ApiError> {
    let company_ids = validate_reducer_scope(contract, &args, organization_id)?;
    let call = ReducerCall::from_name(contract.name, Value::Array(args))
        .map_err(|error| ApiError::Unprocessable(error.to_string()))?;
    let client = state.client_with_token(stdb_token);
    for company_id in company_ids {
        let rows = state
            .stdb
            .query_sql(&format!(
                "SELECT id FROM company WHERE id = {company_id} AND organization_id = {organization_id} LIMIT 1"
            ))
            .await
            .map_err(|error| ApiError::Internal(error.to_string()))?;
        if rows.is_empty() {
            return Err(ApiError::Forbidden(
                "company scope mismatch for reducer call".into(),
            ));
        }
    }
    client
        .call_reducer(call)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(json!({ "ok": true })))
}

fn validate_reducer_scope(
    contract: &'static ReducerContract,
    args: &[Value],
    session_organization_id: u64,
) -> Result<Vec<u64>, ApiError> {
    let company_scope_paths = stdb_client::company_scope_paths(contract.name);
    if let Some(position) = contract.organization_position {
        let requested_organization =
            args.get(position).and_then(Value::as_u64).ok_or_else(|| {
                ApiError::Unprocessable(format!(
                    "Reducer '{}' requires an organization_id at argument {position}",
                    contract.name
                ))
            })?;
        if requested_organization != session_organization_id {
            return Err(ApiError::Forbidden(
                "organization scope mismatch for reducer call".into(),
            ));
        }
    } else if contract.company_position.is_none()
        && company_scope_paths.is_empty()
        && contract.unscoped_reason.is_none()
    {
        return Err(ApiError::Forbidden(format!(
            "Reducer '{}' has no reviewed tenant scope",
            contract.name
        )));
    }

    let mut company_ids = Vec::new();
    if company_scope_paths.is_empty() {
        if let Some(position) = contract.company_position {
            let value = args.get(position).ok_or_else(|| {
                ApiError::Unprocessable(format!(
                    "Reducer '{}' requires company scope at argument {position}",
                    contract.name
                ))
            })?;
            if let Some(company_id) = decode_company_id(contract.name, value, false)? {
                company_ids.push(company_id);
            }
        }
    } else {
        for company_path in company_scope_paths {
            let mut value = args.get(company_path.parameter_position);
            for segment in company_path.path {
                value = value.and_then(|value| value.get(*segment));
            }
            let Some(value) = value else {
                if company_path.required {
                    return Err(ApiError::Unprocessable(format!(
                        "Reducer '{}' requires company scope at argument {} path {}",
                        contract.name,
                        company_path.parameter_position,
                        company_path.path.join(".")
                    )));
                }
                continue;
            };
            if let Some(company_id) =
                decode_company_id(contract.name, value, company_path.nullable)?
            {
                if !company_ids.contains(&company_id) {
                    company_ids.push(company_id);
                }
            }
        }
    }
    if contract.organization_position.is_none()
        && (contract.company_position.is_some() || !company_scope_paths.is_empty())
        && company_ids.is_empty()
    {
        return Err(ApiError::Unprocessable(format!(
            "Reducer '{}' requires a company_id scope",
            contract.name
        )));
    }
    Ok(company_ids)
}

fn decode_company_id(
    reducer_name: &str,
    value: &Value,
    nullable: bool,
) -> Result<Option<u64>, ApiError> {
    if let Some(company_id) = value.as_u64() {
        return Ok(Some(company_id));
    }
    if value.is_null() || value.get("none").is_some() {
        return if nullable {
            Ok(None)
        } else {
            Err(ApiError::Unprocessable(format!(
                "Reducer '{reducer_name}' requires a non-null company_id"
            )))
        };
    }
    if let Some(some) = value.get("some") {
        return some.as_u64().map(Some).ok_or_else(|| {
            ApiError::Unprocessable(format!(
                "Reducer '{reducer_name}' has an invalid company_id option"
            ))
        });
    }
    Err(ApiError::Unprocessable(format!(
        "Reducer '{reducer_name}' has an invalid company_id"
    )))
}

fn load_dotenv_files() {
    // Playwright e2e-smoke sets LUMIERE_E2E=1 and injects STDB_HOST/token via the Makefile so
    // api-server/.env.local (maincloud) does not override local SpacetimeDB settings.
    if std::env::var("LUMIERE_E2E").ok().as_deref() == Some("1") {
        return;
    }
    let _ = dotenvy::dotenv();
    // `dotenv()` only reads `.env` in CWD. When you `cargo run -p api-server` from the repo
    // root, `api-server/.env.local` is never loaded unless we pull it in explicitly.
    let server_local = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".env.local");
    let _ = dotenvy::from_path_override(&server_local);
    let _ = dotenvy::from_filename_override(".env.local");
}

pub async fn serve() -> anyhow::Result<()> {
    load_dotenv_files();
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "api_server=debug,tower_http=info".parse().unwrap()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env()?;

    // Browsers forbid `Access-Control-Allow-Origin: *` when `credentials: 'include'` (web
    // `apiFetch` + `NEXT_PUBLIC_API_GATEWAY_URL`). Use explicit origins + credentials.
    const DEFAULT_DEV_ORIGINS: &[&str] = &[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        // `next start` + Playwright default (`PLAYWRIGHT_BASE_URL` / port 3100)
        "http://localhost:3100",
        "http://127.0.0.1:3100",
    ];

    let origins: Vec<axum::http::HeaderValue> = if config.cors_origins.is_empty() {
        DEFAULT_DEV_ORIGINS
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect()
    } else {
        config
            .cors_origins
            .iter()
            .filter_map(|s| s.parse().ok())
            .collect()
    };

    let allow_origin = if origins.is_empty() {
        tracing::warn!(
            "no valid CORS origins; falling back to http://localhost:3000 (set CORS_ORIGINS otherwise)"
        );
        tower_http::cors::AllowOrigin::exact(
            "http://localhost:3000"
                .parse()
                .expect("static localhost origin"),
        )
    } else {
        tower_http::cors::AllowOrigin::list(origins)
    };

    // With `allow_credentials(true)`, tower-http forbids `*` for methods/headers/expose.
    const CORS_ALLOW_METHODS: [Method; 7] = [
        Method::GET,
        Method::POST,
        Method::PUT,
        Method::PATCH,
        Method::DELETE,
        Method::OPTIONS,
        Method::HEAD,
    ];
    const CORS_ALLOW_HEADERS: [HeaderName; 11] = [
        AUTHORIZATION,
        CONTENT_TYPE,
        ACCEPT,
        ACCEPT_LANGUAGE,
        HeaderName::from_static("x-stdb-identity"),
        COOKIE,
        HeaderName::from_static("connection"),
        HeaderName::from_static("upgrade"),
        HeaderName::from_static("sec-websocket-key"),
        HeaderName::from_static("sec-websocket-version"),
        HeaderName::from_static("sec-websocket-protocol"),
    ];

    let cors = CorsLayer::new()
        .allow_origin(allow_origin)
        .allow_credentials(true)
        .allow_methods(CORS_ALLOW_METHODS)
        .allow_headers(CORS_ALLOW_HEADERS);

    let port = config.port;
    let state = Arc::new(AppState::new(config));
    tracing::info!(
        "api-server on 0.0.0.0:{} → STDB {} / {}",
        port,
        state.config.stdb_host,
        state.config.stdb_module
    );

    let v1 = Router::new()
        .route("/query/:resource", get(get_query))
        .route("/call/:reducer", post(post_call))
        .route("/realtime/ws", get(realtime::realtime_ws_upgrade))
        .route("/realtime/info", get(realtime::realtime_info))
        // Auth + STDB routes before domain routers so `/stdb/*` catch-all does not shadow `/stdb/subscription-queries`.
        .merge(routes::domain_router());

    let app = Router::new()
        .route("/health", get(health))
        .route("/health/ready", get(health_ready))
        .route("/metrics", get(metrics_handler))
        .nest("/v1", v1)
        .layer(CookieManagerLayer::new())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(from_fn(track_http_metrics))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn identity_first_reducer_uses_manifest_organization_position() {
        let contract = stdb_client::reducer_contract("assign_role").expect("assign_role");
        assert!(
            validate_reducer_scope(contract, &[json!({}), json!(9), json!(7), json!({})], 7)
                .is_ok()
        );
        assert!(matches!(
            validate_reducer_scope(contract, &[json!({}), json!(9), json!(8), json!({})], 7),
            Err(ApiError::Forbidden(_))
        ));
    }

    #[test]
    fn company_first_reducer_is_not_compared_directly_to_organization() {
        let contract = stdb_client::reducer_contract("delete_company").expect("delete_company");
        assert_eq!(
            validate_reducer_scope(contract, &[json!(42)], 7).unwrap(),
            vec![42]
        );
    }

    #[test]
    fn nested_optional_company_scope_decodes_stdb_option_json() {
        let contract = stdb_client::reducer_contract("create_contact").expect("create_contact");
        assert_eq!(
            validate_reducer_scope(
                contract,
                &[json!(7), json!({ "company_id": { "some": 42 } })],
                7,
            )
            .unwrap(),
            vec![42]
        );
        assert_eq!(
            validate_reducer_scope(
                contract,
                &[json!(7), json!({ "company_id": { "none": [] } })],
                7,
            )
            .unwrap(),
            Vec::<u64>::new()
        );
        assert!(matches!(
            validate_reducer_scope(contract, &[json!(7), json!({ "company_id": "wrong" })], 7,),
            Err(ApiError::Unprocessable(_))
        ));
    }

    #[test]
    fn zero_arg_and_unknown_reducers_are_not_session_exposed() {
        let zero_arg = stdb_client::reducer_contract("apply_global_migrations")
            .expect("apply_global_migrations");
        assert!(zero_arg.params.is_empty());
        assert_eq!(zero_arg.exposure, Exposure::Denied);
        assert!(stdb_client::reducer_contract("not_a_reducer").is_none());
    }

    #[test]
    fn form_configuration_mutators_are_session_exposed_and_org_scoped() {
        for reducer in [
            "add_form_field",
            "delete_form_field",
            "initialize_default_form_configs",
            "publish_form_configuration",
            "set_form_role_config",
            "update_form_field",
        ] {
            let contract = stdb_client::reducer_contract(reducer).expect(reducer);
            assert_eq!(contract.exposure, Exposure::Session, "{reducer}");
            assert_eq!(contract.organization_position, Some(0), "{reducer}");
            assert_eq!(contract.company_position, None, "{reducer}");
        }
    }

    #[test]
    fn reviewed_unscoped_reducer_is_explicit() {
        let contract = stdb_client::reducer_contract("create_country").expect("create_country");
        assert_eq!(contract.exposure, Exposure::Session);
        assert!(contract.organization_position.is_none());
        assert!(contract.company_position.is_none());
        assert!(contract.unscoped_reason.is_some());
        assert!(validate_reducer_scope(contract, &[json!({})], 7).is_ok());
    }

    #[test]
    fn named_command_injects_organization_at_the_contract_position() {
        let contract = stdb_client::reducer_contract("assign_role").expect("assign_role");
        let args = named_command_args(
            contract,
            json!({
                "user_identity": {},
                "role_id": 9,
                "params": {}
            }),
            7,
        )
        .expect("valid named command");

        assert_eq!(args, vec![json!({}), json!(9), json!(7), json!({})]);
    }

    #[test]
    fn named_command_rejects_client_supplied_tenant_and_missing_fields() {
        let contract = stdb_client::reducer_contract("create_lead").expect("create_lead");
        assert!(matches!(
            named_command_args(contract, json!({ "organization_id": 99, "params": {} }), 7,),
            Err(ApiError::Unprocessable(_))
        ));
        assert!(matches!(
            named_command_args(contract, json!({}), 7),
            Err(ApiError::Unprocessable(_))
        ));
    }

    #[test]
    fn named_command_accepts_camel_case_without_allowing_alias_duplicates() {
        let contract =
            stdb_client::reducer_contract("confirm_sales_order").expect("confirm_sales_order");
        let args = named_command_args(contract, json!({ "companyId": 9, "orderId": 12 }), 7)
            .expect("camel-case input");
        assert_eq!(args, vec![json!(7), json!(9), json!(12)]);
        assert!(matches!(
            named_command_args(
                contract,
                json!({ "companyId": 9, "company_id": 9, "orderId": 12 }),
                7,
            ),
            Err(ApiError::Unprocessable(_))
        ));
    }

    #[test]
    fn named_command_preserves_sats_options_for_central_contract_normalization() {
        let contract = stdb_client::reducer_contract("create_workflow").expect("create_workflow");
        let args = named_command_args(
            contract,
            json!({
                "companyId": { "some": 42 },
                "params": { "metadata": { "none": [] } }
            }),
            7,
        )
        .expect("valid named command");
        assert_eq!(args[0], json!(7));
        assert_eq!(args[1], json!({ "some": 42 }));
        // Composite fields must retain SATS option encoding for SpacetimeDB.
        assert_eq!(args[2]["metadata"], json!({ "none": [] }));

        let args = named_command_args(
            contract,
            json!({
                "companyId": { "none": [] },
                "params": { "metadata": null }
            }),
            7,
        )
        .expect("nullable named command");
        assert_eq!(args[1], json!({ "none": [] }));
    }
}
