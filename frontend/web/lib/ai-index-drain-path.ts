/** Successful ERP writes arrive as typed operations; only those can leave indexing work queued. */
export function isOperationWrite(method: string, pathname: string): boolean {
  return method.toUpperCase() === "POST" && /^\/api\/(operations|compat\/reducer)\/[^/]+$/.test(pathname)
}
