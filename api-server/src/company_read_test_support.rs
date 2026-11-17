//! Loopback SQL fixtures for company-read regressions.
use axum::{http::HeaderMap, routing::post, Json, Router};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use stdb_client::StdbClient;

pub(crate) struct SqlFixture {
    pub client: StdbClient,
    pub requests: Arc<Mutex<Vec<String>>>,
    server: tokio::task::JoinHandle<()>,
}

impl Drop for SqlFixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}

pub(crate) async fn serve(
    respond: impl Fn(&str) -> Vec<Value> + Send + Sync + 'static,
) -> SqlFixture {
    let requests = Arc::new(Mutex::new(Vec::new()));
    let recorded = requests.clone();
    let respond = Arc::new(respond);
    let app = Router::new().route(
        "/v1/database/company-read-test/sql",
        post(move |headers: HeaderMap, sql: String| {
            let recorded = recorded.clone();
            let respond = respond.clone();
            async move {
                assert_eq!(headers["authorization"], "Bearer company-read-actor");
                recorded.lock().unwrap().push(sql.clone());
                Json(sats_rows(&respond(&sql)))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    SqlFixture {
        client: StdbClient::new(
            format!("http://{address}"),
            "company-read-test".into(),
            "company-read-actor".into(),
        )
        .with_http_client(reqwest::Client::builder().no_proxy().build().unwrap()),
        requests,
        server,
    }
}

fn sats_rows(rows: &[Value]) -> Value {
    let names = rows
        .first()
        .map(|row| row.as_object().unwrap().keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let optional = |name: &str| matches!(name, "company_id" | "deleted_at");
    let elements = names
        .iter()
        .map(|name| {
            let value = &rows[0][name];
            let kind = if value.is_boolean() {
                json!({"Bool":[]})
            } else if value.is_number() {
                json!({"U64":[]})
            } else {
                json!({"String":[]})
            };
            let kind = if optional(name) {
                json!({"Sum":{"variants":[
                    {"name":{"some":"some"},"algebraic_type":kind},
                    {"name":{"some":"none"},"algebraic_type":{"Product":{"elements":[]}}}
                ]}})
            } else {
                kind
            };
            json!({"name":{"some":name},"algebraic_type":kind})
        })
        .collect::<Vec<_>>();
    let rows = rows
        .iter()
        .map(|row| {
            names
                .iter()
                .map(|name| {
                    let value = row[name].clone();
                    if optional(name) {
                        if value.is_null() {
                            json!([1, []])
                        } else {
                            json!([0, value])
                        }
                    } else {
                        value
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    json!([{"schema":{"elements":elements},"rows":rows}])
}
