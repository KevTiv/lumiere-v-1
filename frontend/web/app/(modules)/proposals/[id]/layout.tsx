/**
 * Workspace layout override: removes the default module padding so the
 * ProposalWorkspace can fill the available viewport height edge-to-edge.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="-m-6 lg:-m-8 flex flex-col overflow-hidden" style={{ height: "calc(100vh)" }}>
      {children}
    </div>
  )
}
