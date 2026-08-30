import { stdbBffCallUrl, type StdbBffReducerKey } from "@lumiere/stdb/commands"

/** Match a UI mutation against its generated immutable operation identity. */
export function matchesTypedOperationResponse(
  response: { url(): string },
  operationName: StdbBffReducerKey,
): boolean {
  const pathname = new URL(response.url()).pathname
  const operationPath = stdbBffCallUrl(operationName)
  return pathname === operationPath || pathname === `/v1${operationPath.slice(4)}`
}
