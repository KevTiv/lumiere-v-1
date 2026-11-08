"use client"

import { useEffect, useRef } from "react"
import { useErpSession } from "@lumiere/erp-session"
import {
  useAddDocumentVersion,
  useCreateDocumentWithRef,
  useIngestDocumentEvidence,
  useUnlockDocument,
} from "@lumiere/query-hooks/hooks/documents"
import { fetchQueryList } from "@lumiere/query-hooks/http"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { useDocumentUploadReceipts } from "./use-document-upload-receipts"
import { releaseSavedVersionLock } from "./document-version-check-in"
import type { DocumentUploadReceipt } from "./document-upload-receipts"

/** Bind every DMS entry point to the same durable submission owner and current actor. */
export function useManagedDocumentUpload(
  organizationId: bigint,
  companyId: bigint,
  options: { enabled?: boolean; contextKey?: string } = {},
) {
  const session = useErpSession()
  const { permissionsReady, currentUser, checkPermission } = useRBAC()
  const scopeReady = options.enabled !== false && permissionsReady === true &&
    Boolean(session.identity) && session.identity !== "unknown" && currentUser?.id === session.identity &&
    session.organizationId === Number(organizationId) && session.activeCompanyReady === true &&
    Number.isSafeInteger(session.activeCompanyId) && session.activeCompanyId != null &&
    BigInt(session.activeCompanyId) === companyId && companyId > 0n &&
    session.companyIds?.includes(session.activeCompanyId) === true &&
    checkPermission("document", "read").allowed
  const canCreate = scopeReady && checkPermission("document", "create").allowed
  const canVersion = scopeReady && checkPermission("document", "write").allowed
  const scopeKey = JSON.stringify([String(organizationId), String(companyId), session.identity, options.contextKey])
  const current = useRef({ scopeKey, canCreate, canVersion, mounted: true, generation: 0 })
  if (current.current.scopeKey !== scopeKey || current.current.canCreate !== canCreate || current.current.canVersion !== canVersion) current.current.generation++
  current.current = { ...current.current, scopeKey, canCreate, canVersion }
  useEffect(() => {
    current.current.mounted = true
    return () => { current.current.mounted = false; current.current.generation++ }
  }, [])
  const generation = current.current.generation
  const isCurrent = (action?: "create" | "version") => current.current.mounted && current.current.scopeKey === scopeKey &&
    current.current.generation === generation && (action === "create" ? current.current.canCreate : action === "version" ? current.current.canVersion : current.current.canCreate || current.current.canVersion)
  const assertCurrent = (action?: "create" | "version") => {
    if (!isCurrent(action)) throw new Error("Your document workspace or permissions changed. Reopen the current workspace to continue.")
  }
  const create = useCreateDocumentWithRef(organizationId, companyId, { mayDispatch: () => isCurrent("create") })
  const version = useAddDocumentVersion(organizationId, { mayDispatch: () => isCurrent("version") })
  const index = useIngestDocumentEvidence(organizationId)
  const unlock = useUnlockDocument(organizationId)
  const receipts = useDocumentUploadReceipts({
    scope: { organizationId, companyId, actorId: session.identity ?? "" },
    allowed: canCreate || canVersion,
    assertCurrent,
    create: (params) => { assertCurrent("create"); return create.mutateAsync(params) },
    addVersion: (documentId, params) => { assertCurrent("version"); return version.mutateAsync({ documentId, params: { ...params } }) },
    index: (_documentId, receipt) => { assertCurrent(); return index.mutateAsync({ companyId, objectKey: receipt.objectKey }) },
  })
  return {
    ...receipts,
    pending: receipts.pending || create.isPending || version.isPending || index.isPending || unlock.isPending,
    canRead: scopeReady, canCreate, canVersion, assertCurrent,
    releaseVersionLock: (receipt: DocumentUploadReceipt) => releaseSavedVersionLock({
      receipt, scope: { organizationId, companyId, actorId: session.identity ?? "" },
      assertCurrent: () => assertCurrent("version"),
      read: () => fetchQueryList("/api/query/documents", "The saved document lock could not be checked"),
      unlock: (documentId) => unlock.mutateAsync(documentId),
    }),
  }
}
