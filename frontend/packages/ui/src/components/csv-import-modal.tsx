"use client"

import { useState } from "react"
import type { FormConfig } from "../lib/form-types"
import { FormModal } from "../forms/form-modal"
import {
  createCsvImportRequest,
  supportsTrackedCsvImport,
  type CsvImportRequest,
  type TrackedCsvImportScope,
} from "@lumiere/query-hooks/hooks/csv-import-request"
import { useTrackedCsvImport } from "@lumiere/query-hooks/hooks/tracked-csv-import"
import { CsvImportResult } from "../import-assistant/csv-import-result"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog"

export interface CsvImportModalProps {
  onClose: () => void
  config: FormConfig
  isPending?: boolean
  onImport: (csvText: string) => void | Promise<void>
  organizationId?: bigint
  tableName?: string
  trackedImport?: TrackedCsvImportScope
}
function isPositiveId(value: bigint | number | string | undefined): boolean {
  try {
    return value != null && BigInt(value) > 0n
  } catch {
    return false
  }
}

/**
 * Submit one CSV file. When tracked scope is present, the request ID and bytes
 * remain frozen so that a lost response can be recovered without a second effect.
 */
export function CsvImportModal({
  onClose,
  config,
  isPending = false,
  onImport,
  organizationId,
  tableName,
  trackedImport,
}: CsvImportModalProps) {
  const [error, setError] = useState<string | null>(null)
  const [request, setRequest] = useState<CsvImportRequest | null>(null)
  const trackedMutation = useTrackedCsvImport()
  const trackedRequested = trackedImport != null
  const trackedAvailable = Boolean(
    trackedImport != null
      && organizationId
      && organizationId > 0n
      && tableName
      && supportsTrackedCsvImport(tableName)
      && isPositiveId(trackedImport.companyId),
  )
  const unavailableError =
    trackedRequested && !trackedAvailable
      ? "Tracked import is unavailable for this entity or operating-company scope."
      : null

  const handleSubmit = async (data: Record<string, unknown>) => {
    setError(null)
    const files = data.csvFile as FileList | undefined
    const file = files?.[0]
    if (!file) {
      setError("A CSV file is required")
      return
    }

    const csvText = await file.text()
    if (!trackedRequested) {
      try {
        await onImport(csvText)
        onClose()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
      return
    }

    if (!trackedAvailable || !organizationId || !tableName || !trackedImport) {
      setError(unavailableError)
      return
    }

    const next =
      request
      ?? createCsvImportRequest(
        organizationId,
        tableName,
        csvText,
        file.name,
        trackedImport,
      )
    setRequest(next)
    try {
      await trackedMutation.mutateAsync(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  if (request) {
    return (
      <Dialog open onOpenChange={(open) => !open && !trackedMutation.isPending && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{config.title}</DialogTitle>
            {config.description ? (
              <DialogDescription>{config.description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <CsvImportResult
            request={request}
            initialPending={trackedMutation.isPending}
            initialError={error}
            activeOrganizationId={organizationId}
            activeCompanyId={trackedImport?.companyId}
            onNewFile={() => {
              setRequest(null)
              setError(null)
            }}
          />
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      config={config}
      isPending={isPending || trackedMutation.isPending}
      closeOnSubmit={false}
      submissionDisabled={trackedRequested && !trackedAvailable}
      submitError={unavailableError ?? error}
      onSubmit={handleSubmit}
    />
  )
}
