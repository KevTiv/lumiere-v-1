"use client"

import { useState } from "react"
import {
  DashboardSidebar,
  AIChatPanel,
  NotebookPanel,
  JournalPanel,
} from "@lumiere/ui"

function ModulesContent({ children }: { children: React.ReactNode }) {
  const [isAIChatOpen, setIsAIChatOpen] = useState(false)
  const [isAIChatDocked, setIsAIChatDocked] = useState(false)
  const [isNotebookOpen, setIsNotebookOpen] = useState(false)
  const [isJournalOpen, setIsJournalOpen] = useState(false)

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <DashboardSidebar
        activeView=""
        onViewChange={() => {}}
        forceCollapsed={isAIChatDocked || isNotebookOpen}
        onOpenJournal={() => setIsJournalOpen(true)}
        onOpenNotebook={() => setIsNotebookOpen(true)}
        onOpenAIChat={() => setIsAIChatOpen(true)}
      />
      <main className="flex-1 overflow-auto scroll-smooth">
        <div className="p-6 lg:p-8">{children}</div>
      </main>

      <AIChatPanel
        open={isAIChatOpen}
        onClose={() => { setIsAIChatOpen(false); setIsAIChatDocked(false) }}
        docked={isAIChatDocked}
        onDockToggle={() => setIsAIChatDocked((prev) => !prev)}
        context={{}}
        config={{
          title: "ERP Assistant",
          welcomeMessage: "Ask questions about your data or use @ commands for quick actions.",
          placeholder: "Ask anything... Type @ for commands",
        }}
      />

      <NotebookPanel
        open={isNotebookOpen}
        onClose={() => setIsNotebookOpen(false)}
        onAIChat={() => setIsAIChatOpen(true)}
        dataContext={{}}
      />

      <JournalPanel
        open={isJournalOpen}
        onClose={() => setIsJournalOpen(false)}
      />
    </div>
  )
}

export default function ModulesLayout({ children }: { children: React.ReactNode }) {
  return <ModulesContent>{children}</ModulesContent>
}
