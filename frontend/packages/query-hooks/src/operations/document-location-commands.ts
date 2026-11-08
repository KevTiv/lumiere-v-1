import { decodeOperationDispatch } from "@lumiere/api-client"
import { scalarToU64 } from "@lumiere/erp-shared/u64"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch } from "../http"
import type { DocumentLocationAction } from "../hooks/document-location-effect"

/** Typed transport for document/folder location changes; no query cache or UI state. */
export async function dispatchDocumentLocationCommand(action: DocumentLocationAction) {
  const id = scalarToU64(action.id)
  const command = action.kind === "trashFolder"
    ? stdbBffCommandPost("trash_document_folder", { folderId: id })
    : action.kind === "moveFolder"
      ? stdbBffCommandPost("move_document_folder", {
          folderId: id,
          parentId: action.parentId === null ? null : scalarToU64(action.parentId),
        })
      : action.kind === "restoreFolder"
        ? stdbBffCommandPost("restore_document_folder", {
            folderId: id,
            parentId: action.parentId === null ? null : scalarToU64(action.parentId),
          })
        : stdbBffCommandPost("move_document", {
            documentId: id,
            folderId: action.folderId === null ? null : scalarToU64(action.folderId),
          })
  return decodeOperationDispatch(
    await apiFetch(command.urlPath, command.init),
    "The file operation could not be completed",
  )
}
