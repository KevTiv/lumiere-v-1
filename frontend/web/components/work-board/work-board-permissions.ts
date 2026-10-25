import type { RBACContext } from "@lumiere/ui/lib/rbac-types"

/** UI discovery accepts canonical resource or module grants. The query authorizes every row. */
export function canReadWorkflowWork(
  check: RBACContext["checkPermission"],
): boolean {
  return canReadWorkSource(check, ["workflow", "workflows", "module:workflows"])
}

export function canReadRecordFollowups(
  check: RBACContext["checkPermission"],
): boolean {
  return canReadWorkSource(check, ["activity", "activities", "module:crm"])
}

function canReadWorkSource(
  check: RBACContext["checkPermission"],
  resources: string[],
): boolean {
  const results = resources.map((resource) => check(resource, "read"))
  if (results.some((result) => result.rule?.effect === "deny")) return false
  return results.some((result) => result.allowed)
}
