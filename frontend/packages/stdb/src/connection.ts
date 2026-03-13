import type { DbConnection } from "./generated";

let _conn: DbConnection | null = null;

export function setStdbConnection(conn: DbConnection): void {
  _conn = conn;
}

export function getStdbConnection(): DbConnection | null {
  return _conn;
}
