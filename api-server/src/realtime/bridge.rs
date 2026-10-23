//! SpacetimeDB SDK connection, callback registration, and thread lifecycle.

use std::collections::HashSet;

use lumiere_contracts::bindings::DbConnection;
use serde_json::json;
use spacetimedb_sdk::DbContext;
use tokio::sync::mpsc::UnboundedSender;

use super::wire;

#[derive(Clone, Copy)]
enum BridgeTermination {
    Build,
    Runtime,
    Connection,
    Subscription,
    Disconnected,
}

/// The server logs diagnostic details. Clients receive only a finite terminal
/// notice, so a dead SDK connection cannot leave a live but stale browser socket.
fn notify_termination(tx: &UnboundedSender<String>, reason: BridgeTermination) {
    let code = match reason {
        BridgeTermination::Build => "realtime_build_failed",
        BridgeTermination::Runtime => "realtime_runtime_failed",
        BridgeTermination::Connection => "realtime_connection_failed",
        BridgeTermination::Subscription => "realtime_subscription_failed",
        BridgeTermination::Disconnected => "realtime_disconnected",
    };
    let _ = tx.send(
        json!({
            "type":"error", "code":code, "terminal":true,
            "error":"Realtime subscription ended; reconnect required"
        })
        .to_string(),
    );
}

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
        let socket_closed = sdk_tx.clone();
        let sdk_tx_err = sdk_tx.clone();
        let conn_result: Result<DbConnection, spacetimedb_sdk::Error> = DbConnection::builder()
            .with_uri(&stdb_uri)
            .with_database_name(&module)
            .with_token(Some(token))
            .on_connect_error(move |_ctx, err| {
                tracing::error!("realtime STDB connect error: {err:?}");
                notify_termination(&sdk_tx_err, BridgeTermination::Connection);
            })
            .on_connect(move |conn, _ident, _tok| {
                for t in &tables_thread {
                    let company_id =
                        resolved_crm_company_id.filter(|_| crm_tables_thread.contains(t));
                    let callback_resources = super::workflow::callback_resources(t, &res_thread);
                    if let Err(e) = wire::wire_realtime_table_callbacks(
                        conn,
                        t,
                        &callback_resources,
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
                        notify_termination(&tx_err, BridgeTermination::Subscription);
                    })
                    .subscribe(q);
            })
            .build();

        let conn = match conn_result {
            Ok(conn) => conn,
            Err(error) => {
                tracing::error!("realtime STDB build error: {error:?}");
                notify_termination(&socket_closed, BridgeTermination::Build);
                return;
            }
        };

        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(r) => r,
            Err(e) => {
                tracing::error!("realtime runtime: {e}");
                notify_termination(&socket_closed, BridgeTermination::Runtime);
                return;
            }
        };
        rt.block_on(async {
            tokio::select! {
                result = conn.run_async() => {
                    if let Err(error) = result { tracing::debug!("realtime run_async: {error:?}"); }
                    notify_termination(&socket_closed, BridgeTermination::Disconnected);
                }
                _ = socket_closed.closed() => {
                    let _ = conn.disconnect();
                }
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unexpected_sdk_end_emits_a_finite_terminal_notice_without_private_payloads() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        for reason in [
            BridgeTermination::Build,
            BridgeTermination::Runtime,
            BridgeTermination::Connection,
            BridgeTermination::Subscription,
            BridgeTermination::Disconnected,
        ] {
            notify_termination(&tx, reason);
            let notice: serde_json::Value = serde_json::from_str(&rx.try_recv().unwrap()).unwrap();
            assert_eq!(notice["type"], "error");
            assert_eq!(notice["terminal"], true);
            assert!(notice["code"].as_str().unwrap().starts_with("realtime_"));
            assert_eq!(notice.as_object().unwrap().len(), 4);
            assert!(super::super::socket::must_close_after_bridge_message(
                &notice, false
            ));
            assert!(super::super::socket::must_close_after_bridge_message(
                &notice, true
            ));
        }
        drop(rx);
        // Normal receiver shutdown is harmless and the socket_closed branch
        // deliberately does not emit an unexpected-disconnection notice.
        notify_termination(&tx, BridgeTermination::Disconnected);
    }
}
