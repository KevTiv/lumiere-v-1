import { WorkspaceClient } from "./workspace-client"

interface ProposalWorkspacePageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ title?: string }>
}

export default async function ProposalWorkspacePage({ params, searchParams }: ProposalWorkspacePageProps) {
  const { id } = await params
  const { title } = await searchParams

  const proposalTitle = title ? decodeURIComponent(title) : `Proposal ${id}`

  return <WorkspaceClient proposalId={id} proposalTitle={proposalTitle} />
}
