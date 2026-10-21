import {
  STDB_BFF_REDUCERS,
  stdbBffCallUrl,
  type StdbBffReducerKey,
} from "@lumiere/stdb/commands"

function isSessionOperation(operationName: string): operationName is StdbBffReducerKey {
  return (STDB_BFF_REDUCERS as readonly string[]).includes(operationName)
}

/** Match canonical operation traffic or an explicitly named compatibility call. */
export function matchesOperationResponse(
  response: { url(): string },
  operationName: string,
): boolean {
  const pathname = new URL(response.url()).pathname
  const encodedName = encodeURIComponent(operationName)
  if (operationName.startsWith("erp.")) {
    return (
      pathname === `/api/operations/${encodedName}` ||
      pathname === `/v1/operations/${encodedName}`
    )
  }
  if (
    pathname === `/api/compat/reducer/${encodedName}` ||
    pathname === `/v1/compat/reducer/${encodedName}`
  ) {
    return true
  }
  if (!isSessionOperation(operationName)) return false
  const operationPath = stdbBffCallUrl(operationName)
  return pathname === operationPath || pathname === `/v1${operationPath.slice(4)}`
}

/** Resolve named/legacy fault targets to current operation routes, never substrings. */
export function matchesOperationFaultTarget(url: URL, target: string): boolean {
  const legacyName = target.match(/^\/(?:api|v1)\/compat\/reducer\/([^/]+)$/)?.[1]
  const operationName = legacyName ?? target
  return url.pathname === target || matchesOperationResponse(
    { url: () => url.toString() },
    operationName,
  )
}
