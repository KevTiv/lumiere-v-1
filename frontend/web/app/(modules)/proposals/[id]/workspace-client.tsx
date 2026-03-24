"use client"

import { useEffect } from "react"
import { ProposalWorkspace } from "@lumiere/ui"
import type { AIAnalysis } from "@lumiere/ui"
import { useStdbConnection, getStdbConnection, proposalsSubscriptions } from "@lumiere/stdb"

interface WorkspaceClientProps {
  proposalId: string
  proposalTitle: string
  organizationId: number
}

export function WorkspaceClient({ proposalId, proposalTitle, organizationId }: WorkspaceClientProps) {
  const orgId = BigInt(organizationId)
  const { connected } = useStdbConnection()

  // Subscribe to proposal data + products for @-mention search
  useEffect(() => {
    const conn = getStdbConnection()
    if (!conn || !connected) return
    conn.subscriptionBuilder()
      .onError((err) => console.error("[stdb] workspace subscription error", err))
      .subscribe([
        ...proposalsSubscriptions(orgId),
        `SELECT * FROM product WHERE organization_id = ${orgId}`,
      ])
  }, [connected, orgId])

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
      organizationId={orgId}
      onAnalyze={handleAnalyze}
    />
  )
}
