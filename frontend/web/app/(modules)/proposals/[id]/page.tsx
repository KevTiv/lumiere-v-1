import { WorkspaceClient } from "./workspace-client"

interface ProposalWorkspacePageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ title?: string; orgId?: string }>
}

export default async function ProposalWorkspacePage({ params, searchParams }: ProposalWorkspacePageProps) {
  const { id } = await params
  const { title, orgId } = await searchParams

  const proposalTitle = title ? decodeURIComponent(title) : `Proposal ${id}`
  const organizationId = orgId ? Number(orgId) : 1

  return (
    <WorkspaceClient
      proposalId={id}
      proposalTitle={proposalTitle}
      organizationId={organizationId}
    />
  )
}
