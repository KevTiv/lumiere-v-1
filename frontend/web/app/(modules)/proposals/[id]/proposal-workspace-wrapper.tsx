"use client"

import { ProposalWorkspace, type ProposalWorkspaceHooks } from "@lumiere/ui"
import type { AIAnalysis } from "@lumiere/ui"
import {
  useProposalSections,
  useProposalSourceDocs,
  useProposalVersions,
  useProposalLineItems,
  useProposalPresence,
  useProposalComments,
  useUpsertProposalSection,
  useDeleteProposalSection,
  useAddProposalSourceDoc,
  useDeleteProposalSourceDoc,
  useUpdateProposalSourceDoc,
  useSaveProposalVersion,
  useUpdateProposalStatus,
  useAddProposalLineItem,
  useUpdateProposalLineItem,
  useDeleteProposalLineItem,
  useUpdateProposalPresence,
  useClearProposalPresence,
  useAddProposalComment,
  useResolveProposalComment,
} from "@/hooks/proposals"
import { useProducts } from "@/hooks/inventory"
import type { ProposalStatus } from "@lumiere/ui"

interface ProposalWorkspaceWrapperProps {
  proposalId: string
  proposalTitle: string
  organizationId: bigint
  initialStatus?: ProposalStatus
  currentUserId?: string
  currentUserName?: string
  onAnalyze: (text: string) => Promise<AIAnalysis>
}

// HTTP-based hooks adapter for ProposalWorkspace
const httpHooks: ProposalWorkspaceHooks = {
  // Query hooks
  useProposalSections,
  useProposalSourceDocs,
  useProposalVersions,
  useProposalLineItems,
  useProposalPresence,
  useProposalComments,
  useProducts,

  // Mutation hooks
  useUpsertProposalSection,
  useDeleteProposalSection: () => {
    const mutation = useDeleteProposalSection()
    return {
      mutate: (params: { sectionId: bigint | number | string }) => mutation.mutate(params.sectionId),
      isPending: (mutation as { isPending?: boolean }).isPending,
    }
  },
  useAddProposalSourceDoc: () => {
    const mutation = useAddProposalSourceDoc()
    return {
      mutate: (params: {
        proposalId: bigint | number | string
        name: string
        content: string
        docType: string
        wordCount: number
      }) => mutation.mutate(params),
      isPending: (mutation as { isPending?: boolean }).isPending,
    }
  },
  useDeleteProposalSourceDoc: () => {
    const mutation = useDeleteProposalSourceDoc()
    return {
      mutate: (params: { docId: bigint | number | string }) => mutation.mutate(params.docId),
      isPending: (mutation as { isPending?: boolean }).isPending,
    }
  },
  useUpdateProposalSourceDoc: () => {
    const mutation = useUpdateProposalSourceDoc()
    return {
      mutate: (params: {
        docId: bigint | number | string
        name?: string
        content?: string
        docType?: string
        wordCount?: number
      }) => mutation.mutate(params),
      isPending: (mutation as { isPending?: boolean }).isPending,
    }
  },
  useSaveProposalVersion: () => {
    const mutation = useSaveProposalVersion()
    return {
      mutate: (params: {
        proposalId: bigint | number | string
        message: string
        sectionsJson: string
      }) => mutation.mutate(params),
      isPending: (mutation as { isPending?: boolean }).isPending,
    }
  },
  useUpdateProposalStatus: () => {
    const mutation = useUpdateProposalStatus()
    return {
      mutate: (params: { proposalId: bigint | number | string; status: string }) => mutation.mutate(params),
      isPending: (mutation as { isPending?: boolean }).isPending,
    }
  },
  useAddProposalLineItem: () => {
    const mutation = useAddProposalLineItem()
    return {
      mutate: (params: {
        proposalId: bigint | number | string
        sectionId?: bigint | number | string | null
        productId: bigint | number | string
        productName: string
        quantity: number
        priceUnit: number
        discount: number
        notes?: string | null
      }) => mutation.mutate(params),
      isPending: (mutation as { isPending?: boolean }).isPending,
    }
  },
  useUpdateProposalLineItem: () => {
    const mutation = useUpdateProposalLineItem()
    return {
      mutate: (params: {
        lineItemId: bigint | number | string
        quantity: number
        priceUnit: number
        discount: number
        notes?: string | null
      }) => mutation.mutate(params),
      isPending: (mutation as { isPending?: boolean }).isPending,
    }
  },
  useDeleteProposalLineItem: () => {
    const mutation = useDeleteProposalLineItem()
    return {
      mutate: (params: { lineItemId: bigint | number | string }) => mutation.mutate(params.lineItemId),
      isPending: (mutation as { isPending?: boolean }).isPending,
    }
  },
  useUpdateProposalPresence: () => {
    const mutation = useUpdateProposalPresence()
    return {
      mutate: (params: {
        proposalId: bigint | number | string
        sectionId?: bigint | number | string | null
        userName: string
      }) => mutation.mutate(params),
      isPending: (mutation as { isPending?: boolean }).isPending,
    }
  },
  useClearProposalPresence: () => {
    const mutation = useClearProposalPresence()
    return {
      mutate: (proposalId: bigint | number | string) => mutation.mutate(proposalId),
      isPending: (mutation as { isPending?: boolean }).isPending,
    }
  },
  useAddProposalComment: () => {
    const mutation = useAddProposalComment()
    return {
      mutate: (params: {
        proposalId: bigint | number | string
        sectionId: bigint | number | string
        content: string
        parentId?: bigint | number | string | null
        authorName: string
      }) => mutation.mutate(params),
      isPending: (mutation as { isPending?: boolean }).isPending,
    }
  },
  useResolveProposalComment: () => {
    const mutation = useResolveProposalComment()
    return {
      mutate: (commentId: bigint | number | string) => mutation.mutate(commentId),
      isPending: (mutation as { isPending?: boolean }).isPending,
    }
  },
}

export function ProposalWorkspaceWrapper({
  proposalId,
  proposalTitle,
  organizationId,
  initialStatus,
  currentUserId,
  currentUserName,
  onAnalyze,
}: ProposalWorkspaceWrapperProps) {
  return (
    <ProposalWorkspace
      proposalId={proposalId}
      proposalTitle={proposalTitle}
      organizationId={organizationId}
      initialStatus={initialStatus}
      currentUserId={currentUserId}
      currentUserName={currentUserName}
      onAnalyze={onAnalyze}
      hooks={httpHooks}
    />
  )
}
