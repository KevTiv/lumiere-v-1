"use client"

import { useMemo } from "react"
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
  useRestoreProposalVersion,
  useUpdateProposalStatus,
  useAddProposalLineItem,
  useUpdateProposalLineItem,
  useDeleteProposalLineItem,
  useUpdateProposalPresence,
  useClearProposalPresence,
  useAddProposalComment,
  useResolveProposalComment,
  useProposalTemplates,
  useProposalComplianceRequirements,
  useApplyProposalTemplate,
  useUpsertProposalComplianceRequirement,
  useCreateProposalIntegrationIntent,
} from "@lumiere/query-hooks/hooks/proposals"
import { useProducts } from "@lumiere/query-hooks/hooks/inventory"
import type { ProposalStatus } from "@lumiere/ui"

interface ProposalWorkspaceWrapperProps {
  proposalId: string
  proposalTitle: string
  organizationId: bigint
  companyId: bigint
  initialStatus?: ProposalStatus
  currentUserId?: string
  currentUserName?: string
  onAnalyze: (text: string) => Promise<AIAnalysis>
}

function wrapOrgCompanyMutation<TParams>(
  useHook: (
    organizationId: bigint,
    companyId?: bigint,
  ) => { mutate: (params: TParams) => void; isPending: boolean },
  organizationId: bigint,
  companyId: bigint,
): () => { mutate: (params: TParams) => void; isPending?: boolean } {
  return () => {
    const mutation = useHook(organizationId, companyId)
    return {
      mutate: (params) => mutation.mutate(params),
      isPending: mutation.isPending,
    }
  }
}

function createHttpHooks(
  organizationId: bigint,
  companyId: bigint,
): ProposalWorkspaceHooks {
  return {
    useProposalSections: useProposalSections as unknown as ProposalWorkspaceHooks['useProposalSections'],
    useProposalSourceDocs: useProposalSourceDocs as unknown as ProposalWorkspaceHooks['useProposalSourceDocs'],
    useProposalVersions: useProposalVersions as unknown as ProposalWorkspaceHooks['useProposalVersions'],
    useProposalLineItems: useProposalLineItems as unknown as ProposalWorkspaceHooks['useProposalLineItems'],
    useProposalPresence: useProposalPresence as unknown as ProposalWorkspaceHooks['useProposalPresence'],
    useProposalComments: useProposalComments as unknown as ProposalWorkspaceHooks['useProposalComments'],
    useProducts: useProducts as unknown as ProposalWorkspaceHooks['useProducts'],

    useUpsertProposalSection: () => {
      const mutation = useUpsertProposalSection(organizationId, companyId)
      return {
        mutate: (params) => mutation.mutate(params),
        isPending: mutation.isPending,
      }
    },
    useDeleteProposalSection: () => {
      const mutation = useDeleteProposalSection(organizationId, companyId)
      return {
        mutate: (params: { sectionId: bigint | number | string }) =>
          mutation.mutate(params.sectionId),
        isPending: mutation.isPending,
      }
    },
    useAddProposalSourceDoc: () => {
      const mutation = useAddProposalSourceDoc(organizationId, companyId)
      return {
        mutate: (params) => mutation.mutate(params),
        isPending: mutation.isPending,
      }
    },
    useDeleteProposalSourceDoc: () => {
      const mutation = useDeleteProposalSourceDoc(organizationId, companyId)
      return {
        mutate: (params: { docId: bigint | number | string }) => mutation.mutate(params.docId),
        isPending: mutation.isPending,
      }
    },
    useUpdateProposalSourceDoc: () => {
      const mutation = useUpdateProposalSourceDoc(organizationId, companyId)
      return {
        mutate: (params) => mutation.mutate(params),
        isPending: mutation.isPending,
      }
    },
    useSaveProposalVersion: () => {
      const mutation = useSaveProposalVersion(organizationId, companyId)
      return {
        mutate: (params) => mutation.mutate(params),
        isPending: mutation.isPending,
      }
    },
    useRestoreProposalVersion: () => {
      const mutation = useRestoreProposalVersion(organizationId, companyId)
      return {
        mutate: (params) => mutation.mutate(params),
        isPending: mutation.isPending,
      }
    },
    useUpdateProposalStatus: () => {
      const mutation = useUpdateProposalStatus(organizationId, companyId)
      return {
        mutate: (params) => mutation.mutate(params),
        isPending: mutation.isPending,
      }
    },
    useAddProposalLineItem: () => {
      const mutation = useAddProposalLineItem(organizationId, companyId)
      return {
        mutate: (params) => mutation.mutate(params),
        isPending: mutation.isPending,
      }
    },
    useUpdateProposalLineItem: () => {
      const mutation = useUpdateProposalLineItem(organizationId, companyId)
      return {
        mutate: (params) => mutation.mutate(params),
        isPending: mutation.isPending,
      }
    },
    useDeleteProposalLineItem: () => {
      const mutation = useDeleteProposalLineItem(organizationId, companyId)
      return {
        mutate: (params: { lineItemId: bigint | number | string }) =>
          mutation.mutate(params.lineItemId),
        isPending: mutation.isPending,
      }
    },
    useUpdateProposalPresence: () => {
      const mutation = useUpdateProposalPresence(organizationId, companyId)
      return {
        mutate: (params) => mutation.mutate(params),
        isPending: mutation.isPending,
      }
    },
    useClearProposalPresence: () => {
      const mutation = useClearProposalPresence(organizationId, companyId)
      return {
        mutate: (proposalId: bigint | number | string) => mutation.mutate(proposalId),
        isPending: mutation.isPending,
      }
    },
    useAddProposalComment: () => {
      const mutation = useAddProposalComment(organizationId, companyId)
      return {
        mutate: (params) => mutation.mutate(params),
        isPending: mutation.isPending,
      }
    },
    useResolveProposalComment: () => {
      const mutation = useResolveProposalComment(organizationId, companyId)
      return {
        mutate: (commentId: bigint | number | string) => mutation.mutate(commentId),
        isPending: mutation.isPending,
      }
    },
    useProposalTemplates: useProposalTemplates as unknown as ProposalWorkspaceHooks['useProposalTemplates'],
    useProposalComplianceRequirements:
      useProposalComplianceRequirements as unknown as ProposalWorkspaceHooks['useProposalComplianceRequirements'],
    useApplyProposalTemplate: wrapOrgCompanyMutation(
      useApplyProposalTemplate,
      organizationId,
      companyId,
    ),
    useUpsertProposalComplianceRequirement: wrapOrgCompanyMutation(
      useUpsertProposalComplianceRequirement,
      organizationId,
      companyId,
    ),
    useCreateProposalIntegrationIntent: wrapOrgCompanyMutation(
      useCreateProposalIntegrationIntent,
      organizationId,
      companyId,
    ),
  }
}

export function ProposalWorkspaceWrapper({
  proposalId,
  proposalTitle,
  organizationId,
  companyId,
  initialStatus,
  currentUserId,
  currentUserName,
  onAnalyze,
}: ProposalWorkspaceWrapperProps) {
  const httpHooks = useMemo(
    () => createHttpHooks(organizationId, companyId),
    [organizationId, companyId],
  )
  return (
    <ProposalWorkspace
      proposalId={proposalId}
      proposalTitle={proposalTitle}
      organizationId={organizationId}
      companyId={companyId}
      initialStatus={initialStatus}
      currentUserId={currentUserId}
      currentUserName={currentUserName}
      onAnalyze={onAnalyze}
      hooks={httpHooks}
    />
  )
}
