import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { encodeTaggedUnitEnum } from "@lumiere/erp-shared/stdb-params-json"

/** Validate UI task states and encode their SpacetimeDB HTTP unit variants. */
export function buildTaskStateCommand(taskId: string | number | bigint, state: unknown) {
  const tag =
    typeof state === "string"
      ? state
      : state && typeof state === "object" && "tag" in state
        ? String((state as { tag: unknown }).tag)
        : ""
  if (!["Cancelled", "InProgress", "Done", "Approved", "ChangesRequested"].includes(tag)) {
    throw new Error("Invalid task state")
  }
  return stdbBffCommandPost("update_task_state", {
    taskId,
    state: encodeTaggedUnitEnum({ tag }),
  })
}
