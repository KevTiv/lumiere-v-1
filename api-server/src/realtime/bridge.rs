//! SpacetimeDB SDK connection, callback registration, and thread lifecycle.

use std::collections::HashSet;

use lumiere_contracts::bindings::DbConnection;
use serde_json::json;
use spacetimedb_sdk::DbContext;
use tokio::sync::mpsc::UnboundedSender;

use super::wire;

pub(super) fn spawn_subscription_bridge(
    stdb_uri: String,
    module: String,
    token: String,
    tables_thread: Vec<String>,
    crm_tables_thread: HashSet<String>,
    resolved_crm_company_id: Option<u64>,
    res_thread: Vec<String>,
    queries_thread: Vec<String>,
    sdk_tx: UnboundedSender<String>,
) {
    std::thread::spawn(move || {
        let sdk_tx_err = sdk_tx.clone();
        let conn_result: Result<DbConnection, spacetimedb_sdk::Error> = DbConnection::builder()
            .with_uri(&stdb_uri)
            .with_database_name(&module)
            .with_token(Some(token))
            .on_connect_error(move |_ctx, err| {
                tracing::error!("realtime STDB connect error: {err:?}");
                let _ = sdk_tx_err.send(
                    json!({ "type": "error", "error": format!("connect_error: {err:?}") })
                        .to_string(),
                );
            })
            .on_connect(move |conn, _ident, _tok| {
                for t in &tables_thread {
                    let company_id =
                        resolved_crm_company_id.filter(|_| crm_tables_thread.contains(t));
                    if let Err(e) = wire::wire_realtime_table_callbacks(
                        conn,
                        t,
                        &res_thread,
                        company_id,
                        &sdk_tx,
                    ) {
                        tracing::debug!("realtime skip wire for table {t}: {e}");
                    }
                }

                let res_applied = res_thread.clone();
                let tx_ok = sdk_tx.clone();
                let tx_err = sdk_tx.clone();
                let q = queries_thread.clone();
                conn.subscription_builder()
                    .on_applied(move |_ctx| {
                        let _ = tx_ok.send(
                            json!({ "type": "subscribed", "resources": res_applied }).to_string(),
                        );
                    })
                    .on_error(move |_ctx, err| {
                        tracing::error!("realtime STDB subscription error: {err:?}");
                        let _ = tx_err.send(
                            json!({ "type": "error", "error": format!("{err:?}") }).to_string(),
                        );
                    })
                    .subscribe(q);
            })
            .build();

        let Ok(conn) = conn_result else {
            return;
        };

        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(r) => r,
            Err(e) => {
                tracing::error!("realtime runtime: {e}");
                return;
            }
        };
        if let Err(e) = rt.block_on(conn.run_async()) {
            tracing::debug!("realtime run_async: {e:?}");
        }
    });
}
