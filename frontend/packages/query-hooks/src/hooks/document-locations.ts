"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { decodeOperationDispatch } from "@lumiere/api-client"
import { scalarToU64 } from "@lumiere/erp-shared/u64"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import type { DocumentFolder } from "@lumiere/stdb/types"
import { apiFetch, fetchQueryList, rqBigIntKey } from "../http"
import { documentLocationResource, normalizeDocumentLocationAction, resolveDocumentLocationEffect, type DocumentLocationAction } from "./document-location-effect"
import { executeOperationWithCanonicalReadback, requireResolvedOperationEffect } from "./operation-effect"
import { documentReadRefresh } from "./document-read-refresh"

export function useDeletedDocumentFolders(organizationId: bigint, companyId: bigint, enabled: boolean) {
  return useQuery<DocumentFolder[]>({
    queryKey: ["document-folders-deleted", rqBigIntKey(organizationId), rqBigIntKey(companyId)],
    queryFn: () => fetchQueryList(`/api/query/document-folders-deleted?companyId=${companyId}`, "Failed to load folder trash"),
    ...documentReadRefresh,
    enabled,
    staleTime: 0,
  })
}

/** All folder/file moves use explicit nullable destinations and exact authorized readback. */
export function useDocumentLocationMutation(
  organizationId: bigint,
  companyId: bigint,
  assertCurrent: (action: DocumentLocationAction) => void,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (action: DocumentLocationAction) => {
      action = normalizeDocumentLocationAction(action)
      assertCurrent(action)
      const id = scalarToU64(action.id)
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () => {
          assertCurrent(action)
          const rows = await fetchQueryList(`/api/query/${documentLocationResource(action)}?companyId=${companyId}`, "Could not verify the file operation")
          assertCurrent(action)
          return resolveDocumentLocationEffect(rows, organizationId, companyId, action)
        },
        dispatch: async () => {
          assertCurrent(action)
          const command = action.kind === "trashFolder"
            ? stdbBffCommandPost("trash_document_folder", { folderId: id })
            : action.kind === "moveFolder"
              ? stdbBffCommandPost("move_document_folder", { folderId: id, parentId: action.parentId === null ? null : scalarToU64(action.parentId) })
              : action.kind === "restoreFolder"
                ? stdbBffCommandPost("restore_document_folder", { folderId: id, parentId: action.parentId === null ? null : scalarToU64(action.parentId) })
                : stdbBffCommandPost("move_document", { documentId: id, folderId: action.folderId === null ? null : scalarToU64(action.folderId) })
          return decodeOperationDispatch(await apiFetch(command.urlPath, command.init), "The file operation could not be completed")
        },
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })
      const result = requireResolvedOperationEffect(outcome)
      await Promise.all(["documents", "documents-deleted", "document-versions", "document-folders", "document-folders-deleted"].map((resource) =>
        queryClient.invalidateQueries({ queryKey: [resource, rqBigIntKey(organizationId)] }),
      ))
      return result
    },
  })
}
