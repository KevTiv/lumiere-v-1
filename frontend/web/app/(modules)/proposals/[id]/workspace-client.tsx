"use client"

import { phCapture } from "@/lib/posthog-browser"
import { useProposalsModuleSubscription } from "@/lib/module-subscription-hooks"
import { apiFetch } from '@/lib/api-fetch'
import { ProposalWorkspaceWrapper } from "./proposal-workspace-wrapper"
import type { AIAnalysis } from "@lumiere/ui"

interface WorkspaceClientProps {
  proposalId: string
  proposalTitle: string
  organizationId: number
}

export function WorkspaceClient({ proposalId, proposalTitle, organizationId }: WorkspaceClientProps) {
  useProposalsModuleSubscription()
  const orgId = BigInt(organizationId)

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

    return response.json() as Promise<AIAnalysis>
  }

  return (
    <ProposalWorkspaceWrapper
      proposalId={proposalId}
      proposalTitle={proposalTitle}
      organizationId={orgId}
      onAnalyze={handleAnalyze}
    />
  )
}
