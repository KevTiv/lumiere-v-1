import { decodeOperationDispatch } from "@lumiere/api-client"
import { scalarToU64, type ScalarId } from "@lumiere/erp-shared/u64"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch } from "../http"
import type { DocumentLocationAction } from "../hooks/document-location-effect"

function commandId(value: ScalarId): number | string {
  const id = scalarToU64(value)
  // The named operation endpoint accepts exact decimal strings for u64 fields.
  return id <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(id) : id.toString()
}

/** Typed transport for document/folder location changes; no query cache or UI state. */
export async function dispatchDocumentLocationCommand(
  action: DocumentLocationAction,
) {
  const id = commandId(action.id)
  const command =
    action.kind === "trashFolder"
      ? stdbBffCommandPost("trash_document_folder", { folderId: id })
      : action.kind === "moveFolder"
        ? stdbBffCommandPost("move_document_folder", {
            folderId: id,
            parentId:
              action.parentId === null ? null : commandId(action.parentId),
          })
        : action.kind === "restoreFolder"
          ? stdbBffCommandPost("restore_document_folder", {
              folderId: id,
              parentId:
                action.parentId === null ? null : commandId(action.parentId),
            })
          : stdbBffCommandPost("move_document", {
              documentId: id,
              folderId:
                action.folderId === null ? null : commandId(action.folderId),
            })
  return decodeOperationDispatch(
    await apiFetch(command.urlPath, command.init),
    "The file operation could not be completed",
  )
}
