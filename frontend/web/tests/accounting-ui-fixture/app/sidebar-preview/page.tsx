"use client"

import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider } from "@lumiere/i18n"
import { RBACProvider } from "../../../../../packages/ui/src/lib/rbac-context"
import { ThemeProvider } from "../../../../../packages/ui/src/components/theme-provider"
import { DashboardSidebar } from "../../../../../packages/ui/src/pages/dashboard-sidebar"
import { DashboardWorkspace } from "../../../../../packages/ui/src/pages/dashboard-workspace"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../../packages/ui/src/components/table"
import { Input } from "../../../../../packages/ui/src/components/input"

export default function Page() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  const [hydrated, setHydrated] = useState(false)
  const [search, setSearch] = useState("")
  const [action, setAction] = useState("")
  useEffect(() => setHydrated(true), [])
  const rows = Array.from({ length: 61 }, (_, index) => ({ id: index + 1, name: `Record ${index + 1}` })).filter((row) => row.name.includes(search))
  return <QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ThemeProvider defaultTheme="light">
    <DashboardWorkspace userProfile={{ name: "Preview User" }} onOpenSearch={() => {}} sidebar={<DashboardSidebar onOpenJournal={() => setAction("journal")} onOpenAIChat={() => setAction("AI")} />}>
      <p data-testid="sidebar-preview-ready" data-hydrated={hydrated}>Synthetic table and navigation preview</p>
      <h1 className="my-4 text-2xl font-semibold">Records</h1>
      <Input aria-label="Filter records" value={search} onChange={(event) => setSearch(event.target.value)} className="mb-4 max-w-sm" />
      <Table><TableHeader><TableRow><TableHead>Record</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
        <TableBody>{rows.map((row) => <TableRow key={row.id}>
          <TableCell data-testid={`record-name-${row.id}`}>{row.name}</TableCell>
          <TableCell><details open={row.id === 1}><summary>Source details</summary><div className="flex flex-col gap-3 py-3">{Array.from({ length: 8 }, (_, index) => <p key={index}>Source field {index + 1}</p>)}</div></details></TableCell>
        </TableRow>)}</TableBody>
      </Table>
      <output>{action}</output>
    </DashboardWorkspace>
  </ThemeProvider></RBACProvider></I18nProvider></QueryClientProvider>
}
