"use client"

import { ProposalWorkspace } from "@lumiere/ui"
import type { AIAnalysis } from "@lumiere/ui"

interface WorkspaceClientProps {
  proposalId: string
  proposalTitle: string
}

export function WorkspaceClient({ proposalId, proposalTitle }: WorkspaceClientProps) {
  const handleAnalyze = async (text: string): Promise<AIAnalysis> => {
    const response = await fetch("/api/proposals/analyze", {
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
    <ProposalWorkspace
      proposalId={proposalId}
      proposalTitle={proposalTitle}
      onAnalyze={handleAnalyze}
    />
  )
}
