/**
 * Workspace layout override: removes the default module padding so the
 * ProposalWorkspace can fill the available viewport height edge-to-edge.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 -my-5 flex h-dvh min-w-0 flex-col overflow-hidden sm:-mx-6 lg:-mx-8 lg:-my-7">
      {children}
    </div>
  )
}
