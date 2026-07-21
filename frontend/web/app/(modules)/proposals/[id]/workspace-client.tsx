"use client"

import { phCapture } from "@/lib/posthog-browser"
import { useProposalsModuleSubscription } from "@/lib/module-subscription-hooks"
import { apiFetch } from "@/lib/api-fetch"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useApplyProposalAnalysis } from "@lumiere/query-hooks/hooks/proposals"
import { ProposalWorkspaceWrapper } from "./proposal-workspace-wrapper"
import type { AIAnalysis } from "@lumiere/ui"

interface WorkspaceClientProps {
  proposalId: string
  proposalTitle: string
  organizationId: number
}

function isMockAnalysis(result: AIAnalysis): boolean {
  return (
    typeof result.summary === "string" &&
    (result.summary.toLowerCase().includes("mock") || result.keyFindings.length === 0)
  )
}

export function WorkspaceClient({ proposalId, proposalTitle, organizationId }: WorkspaceClientProps) {
  useProposalsModuleSubscription()
  const orgId = BigInt(organizationId)
  const companyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const applyAnalysis = useApplyProposalAnalysis(orgId, companyId)

  const handleAnalyze = async (text: string): Promise<AIAnalysis> => {
    phCapture("proposal_analysis_requested", { proposal_id: proposalId, organization_id: organizationId })
    const response = await apiFetch("/api/proposals/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, proposalId }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(err || "Analysis request failed")
    }

    const result = (await response.json()) as AIAnalysis
    const isMock = isMockAnalysis(result)

    // Persist analysis + materialize compliance (Wave D). UI still works if persist fails.
    try {
      await applyAnalysis.mutateAsync({
        proposalId,
        source: isMock ? "mock" : "analyze_api",
        isMock,
        findingsJson: JSON.stringify(result.keyFindings ?? []),
        requirementsJson: JSON.stringify(result.requirements ?? []),
        evaluationCriteriaJson: JSON.stringify(result.evaluationCriteria ?? []),
        suggestedSectionsJson: JSON.stringify(result.suggestedSections ?? []),
        scoreJson: null,
        materializeCompliance: true,
      })
    } catch {
      // Compliance rows may be missing when persist fails.
    }

    return result
  }

  return (
    <ProposalWorkspaceWrapper
      proposalId={proposalId}
      proposalTitle={proposalTitle}
      organizationId={orgId}
      companyId={companyId}
      onAnalyze={handleAnalyze}
    />
  )
}
