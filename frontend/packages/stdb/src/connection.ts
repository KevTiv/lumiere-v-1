import type { DbConnection } from "./generated";

let _conn: DbConnection | null = null;

/** Pass `null` when the websocket is torn down so readers never hold a dead connection. */
export function setStdbConnection(conn: DbConnection | null): void {
  _conn = conn;
}

export function getStdbConnection(): DbConnection | null {
  return _conn;
}
