"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "../http"
import { scalarToU64 as toScalarU64, type ScalarId } from "@lumiere/erp-shared/u64"
import { responseErrorMessage as parseCallErrorAiEvidence } from "@lumiere/api-client/response-error"

export type EvidenceInspectionState = "unverified_recollection" | "user_reported" | "inspected"

export type RecordEvidenceContributionParams = {
  companyId: ScalarId
  sessionRef: string
  turnRef?: string
  eventRef: string
  inspectionState: EvidenceInspectionState
  note?: string
} & (
  | { introducedKind: "concept" }
  | ({ introducedKind: "source_version"; isSecondaryQuotation?: boolean } & (
      | { sourceVersionId: ScalarId; passageId?: never }
      | { passageId: ScalarId; sourceVersionId?: never }
    ))
)

/**
 * Records a user-authored discussion contribution (AIH-13/14). Identity is
 * derived from the authenticated session server-side — the caller only names
 * what was introduced (a cited passage/source version, or a concept) and how
 * they know it.
 */
export function useRecordEvidenceContribution(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: RecordEvidenceContributionParams) => {
      const r = await apiFetch("/api/ai/evidence/contributions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: Number(toScalarU64(params.companyId)),
          sessionRef: params.sessionRef,
          ...(params.turnRef ? { turnRef: params.turnRef } : {}),
          eventRef: params.eventRef,
          introducedKind: params.introducedKind,
          ...(params.introducedKind === "source_version" && "sourceVersionId" in params && params.sourceVersionId !== undefined
            ? { sourceVersionId: Number(toScalarU64(params.sourceVersionId)) }
            : {}),
          ...(params.introducedKind === "source_version" && "passageId" in params && params.passageId !== undefined
            ? { passageId: Number(toScalarU64(params.passageId)) }
            : {}),
          inspectionState: params.inspectionState,
          isSecondaryQuotation:
            params.introducedKind === "source_version" ? Boolean(params.isSecondaryQuotation) : false,
          ...(params.note ? { note: params.note } : {}),
        }),
      })
      if (!r.ok) throw new Error(await parseCallErrorAiEvidence(r))
      return (await r.json()) as { ok: boolean; eventRef?: string }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-evidence"] })
    },
  })
}
