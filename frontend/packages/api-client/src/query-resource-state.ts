export type QueryResourceState<Row> =
  | { readonly status: "ready"; readonly rows: Row[] }
  | { readonly status: "empty"; readonly rows: [] }
  | { readonly status: "denied"; readonly rows: []; readonly message: string }
  | { readonly status: "unavailable"; readonly rows: []; readonly message: string }

export function queryResourceRows<Row>(rows: Row[]): QueryResourceState<Row> {
  return rows.length > 0
    ? { status: "ready", rows }
    : { status: "empty", rows: [] }
}

export function queryResourceFailure(
  status: number | undefined,
  message: string,
): QueryResourceState<never> {
  return status === 401 || status === 403
    ? { status: "denied", rows: [], message }
    : { status: "unavailable", rows: [], message }
}
