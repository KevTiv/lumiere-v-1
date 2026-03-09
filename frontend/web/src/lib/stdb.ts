import { DbConnection } from "@lumiere/stdb";

const HOST = import.meta.env.VITE_STDB_HOST ?? "wss://maincloud.spacetimedb.com";
const MODULE = import.meta.env.VITE_STDB_MODULE ?? "lumiere-v1";
const TOKEN_KEY = "lumiere_stdb_token";

let _conn: DbConnection | null = null;
let _initPromise: Promise<DbConnection> | null = null;

export function getStdb(): DbConnection {
  if (!_conn) throw new Error("SpacetimeDB not yet connected");
  return _conn;
}

export function initStdb(): Promise<DbConnection> {
  if (_conn) return Promise.resolve(_conn);
  if (_initPromise) return _initPromise;

  _initPromise = new Promise((resolve, reject) => {
    const token = localStorage.getItem(TOKEN_KEY) ?? undefined;

    DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(MODULE)
      .withToken(token)
      .onConnect((conn, _identity, newToken) => {
        localStorage.setItem(TOKEN_KEY, newToken);
        conn
          .subscriptionBuilder()
          .onApplied(() => {
            _conn = conn;
            resolve(conn);
          })
          .onError((_ctx) => reject(new Error("Subscription error")))
          .subscribe([
            "SELECT * FROM iot_hub",
            "SELECT * FROM iot_device",
            "SELECT * FROM iot_telemetry",
            "SELECT * FROM iot_action",
            "SELECT * FROM iot_alert",
            "SELECT * FROM iot_pairing_token",
          ]);
      })
      .onDisconnect(() => { _conn = null; })
      .onConnectError((_ctx, err) => reject(err))
      .build();
  });

  return _initPromise;
}
