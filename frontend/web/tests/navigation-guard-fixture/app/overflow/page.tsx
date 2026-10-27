"use client"

import { useEffect, useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider, i18n } from "@lumiere/i18n"
import { createLumiereApiClient, LumiereApiProvider } from "@lumiere/api-client"
import { RBACProvider } from "../../../../../packages/ui/src/lib/rbac-context"
import { Button } from "../../../../../packages/ui/src/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../../../packages/ui/src/components/dialog"
import { FormModal } from "../../../../../packages/ui/src/forms/form-modal"
import type { FormConfig } from "../../../../../packages/ui/src/lib/form-types"
import { EntityTable } from "../../../../../packages/ui/src/entity-views/entity-table"
import { EntityRecordSheet } from "../../../../../packages/ui/src/entity-views/entity-record-sheet"
import { EntityDetail } from "../../../../../packages/ui/src/entity-views/entity-detail"
import { EntityBoardView } from "../../../../../packages/ui/src/entity-views/entity-board"
import { EntityPivotView } from "../../../../../packages/ui/src/entity-views/entity-pivot"
import { RecordAttachmentsPanel } from "../../../../../packages/ui/src/documents/record-attachments-panel"
import { AIChatPanel } from "../../../../../packages/ui/src/ai-chat/ai-chat-panel"
import { pivotConfig } from "../../../../../packages/ui/src/lib/entity-state-board"
import type {
  EntityDetailConfig,
  EntityTableConfig,
} from "../../../../../packages/ui/src/lib/entity-view-types"
import { QueryBuilder } from "../../../../app/(modules)/reports/query-builder"

const apiClient = createLumiereApiClient({ baseUrl: "" })
const longValue = `https://example.test/${"unbroken".repeat(32)}`
const rows = [
  {
    id: 1,
    name: longValue,
    state: "open",
    amount: 123456789012.34,
    owner: longValue,
    external: longValue,
  },
]
const detail: EntityDetailConfig = {
  mode: "detail",
  sections: [
    {
      id: "fields",
      fields: [
        { key: "name", label: "Reference", width: "1/2" },
        { key: "owner", label: "Owner", width: "1/2" },
        {
          key: "state",
          label: "Long status",
          type: "badge",
          badgeLabels: { open: longValue },
          width: "full",
        },
      ],
    },
  ],
}

const modalError = `The example save was rejected. Your entries are still available. ${"Check the selected company, supporting document and commercial reference before trying again. ".repeat(8)}Reference: ${"unbroken".repeat(26)}`
const stressForm: FormConfig = {
  id: "overflow-stress",
  title: "Review a commercial document with a long business reference and translated title",
  description: "Complete the business information and review the selected customer before saving this synthetic draft.",
  submitLabel: "Save this document as a draft for later review",
  cancelLabel: "Cancel and return to the document list",
  sections: [{ id: "details", fields: [
    { id: "customer", name: "customer", label: "Customer or organisation responsible for this commercial document", type: "select", searchable: true, defaultValue: "1", options: [
      { value: "1", label: "Acme trading company" },
      { value: "2", label: `International customer with a long registered business name ${"unbroken".repeat(12)}` },
    ] },
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `reference-${index}`, name: `reference-${index}`, type: "text" as const,
      label: `Business reference ${index + 1} with a longer translated description`, defaultValue: `Original value ${index + 1}`,
    })),
  ] }],
}

function Sample({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section data-testid={id} className="min-w-0 space-y-2 border p-3">
      <h2>{id}</h2>
      {children}
    </section>
  )
}

export default function OverflowFixture() {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  )
  const [width, setWidth] = useState("320")
  const [expanded, setExpanded] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [plainDialog, setPlainDialog] = useState(false)
  const [formDialog, setFormDialog] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [chat, setChat] = useState<"closed" | "floating" | "docked">("closed")
  const [lastAction, setLastAction] = useState("")
  const table: EntityTableConfig = {
    mode: "table",
    rowKey: "id",
    listViewKey: "overflow-fixture",
    searchable: true,
    searchKeys: ["name"],
    columns: [
      { key: "name", label: "Reference" },
      { key: "state", label: "Status" },
      { key: "amount", label: "Amount", type: "currency" },
    ],
    filters: [
      {
        key: "state",
        label: "Status",
        type: "select",
        options: [{ value: "open", label: "Open" }],
      },
    ],
    actions: [
      ...["Create", "Import", "Reconcile", "Schedule", "Long"].map((id) => ({
        id,
        label: id === "Long" ? longValue : `${id} records`,
        onClick: () => setLastAction(id),
        permission: { resource: "module:inventory", action: "create" as const },
      })),
      {
        id: "selected",
        label: `Selected ${longValue}`,
        requiresSelection: true,
        onClick: () => setLastAction("selected"),
      },
    ],
  }
  return (
    <QueryClientProvider client={queryClient}>
      <LumiereApiProvider client={apiClient}>
        <I18nProvider language="en">
          <RBACProvider key={String(readOnly)} useDefaultFixtures={!readOnly}>
            <div className="flex h-screen overflow-hidden">
              <aside style={{ width: expanded ? 256 : 48 }} className="shrink-0">
                <button onClick={() => setExpanded(!expanded)} aria-label="Toggle sidebar">
                  ☰
                </button>
              </aside>
              <main className="min-w-0 flex-1 overflow-auto p-4">
                <span data-testid="overflow-fixture-ready" data-hydrated={hydrated} className="sr-only">Synthetic overflow fixture</span>
                <div className="flex flex-wrap gap-2 pb-4">
                  <label>
                    Panel width{" "}
                    <select
                      aria-label="Panel width"
                      value={width}
                      onChange={(event) => setWidth(event.target.value)}
                    >
                      {[240, 320, 560, 1200].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <Button onClick={() => setReadOnly(!readOnly)}>Toggle read-only</Button>
                  <Button onClick={() => setSheet(true)}>Open record sheet</Button>
                  <Button onClick={() => setPlainDialog(true)}>Open stressed plain dialog</Button>
                  <Button onClick={() => { setFormError(null); setFormDialog(true) }}>Open stressed form dialog</Button>
                  <Button onClick={() => setChat("floating")}>Open floating chat</Button>
                  <Button onClick={() => setChat("docked")}>Open docked chat</Button>
                </div>
                <output data-testid="last-action">{lastAction}</output>
                <div
                  data-testid="sample-panel"
                  className="space-y-4"
                  style={{ width: `min(100%, ${width}px)` }}
                >
                  <Sample id="toolbar-sample">
                    <EntityTable
                      config={table}
                      data={rows}
                      allowExport
                      initialFilters={{ external: longValue }}
                      onInitialFilterClear={() => {}}
                    />
                  </Sample>
                  <Sample id="detail-sample">
                    <EntityDetail config={detail} data={rows[0]} />
                  </Sample>
                  <Sample id="attachments-sample">
                    <RecordAttachmentsPanel
                      resModel="sale_order"
                      resId={1}
                      documents={[
                        {
                          id: 1,
                          name: `${"filename".repeat(32)}.pdf`,
                          url: longValue,
                          mimetype: "application/pdf",
                          resModel: "sale_order",
                          resId: 1,
                        },
                      ]}
                      onUpload={async () => {}}
                    />
                  </Sample>
                  <Sample id="board-sample">
                    <EntityBoardView
                      columns={[
                        { id: "open", title: "Open" },
                        { id: "done", title: "Done" },
                      ]}
                      data={rows}
                      config={{
                        mode: "board",
                        groupKey: "state",
                        card: {
                          titleKey: "name",
                          fields: [
                            { key: "owner", label: "Owner" },
                            {
                              key: "state",
                              label: "Status",
                              type: "badge",
                              badgeLabels: { open: longValue },
                            },
                          ],
                          footerFields: [
                            { key: "owner", label: "Owner" },
                            { key: "amount", label: "Total", type: "currency" },
                          ],
                        },
                      }}
                    />
                  </Sample>
                  <Sample id="pivot-sample">
                    <EntityPivotView
                      rows={rows}
                      table={table}
                      pivot={pivotConfig(i18n.t, { groupKeys: ["state"], measureKeys: ["amount"] })}
                    />
                  </Sample>
                  <Sample id="query-sample">
                    <QueryBuilder
                      organizationId={1n}
                      dashboards={[]}
                      status={null}
                      onStatusChange={() => {}}
                    />
                  </Sample>
                </div>
              </main>
              <Dialog open={plainDialog} onOpenChange={setPlainDialog}>
                <DialogContent data-testid="plain-stress-dialog">
                  <DialogHeader>
                    <DialogTitle>Review a document with a long translated confirmation title</DialogTitle>
                    <DialogDescription>Inspect every entry before confirming this synthetic action.</DialogDescription>
                  </DialogHeader>
                  <div data-testid="plain-stress-body" className="space-y-4">
                    {Array.from({ length: 20 }, (_, index) => <p key={index} data-testid={`plain-stress-row-${index}`}>Document entry {index + 1}: {longValue}</p>)}
                  </div>
                  <DialogFooter>
                    <Button data-testid="plain-stress-confirm" onClick={() => setPlainDialog(false)}>Confirm document review</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <FormModal
                open={formDialog}
                onOpenChange={setFormDialog}
                config={stressForm}
                submitError={formError}
                draft={false}
                showSubmitSuccessToast={false}
                onSubmit={async () => { setFormError(modalError); throw new Error("Synthetic save rejected") }}
              />
              <EntityRecordSheet
                open={sheet}
                onOpenChange={setSheet}
                config={{
                  titleKey: "state",
                  detailConfig: detail,
                  customTabs: [
                    ...[
                      "Variants",
                      "Vendor prices",
                      "Packaging",
                      "Onboarding",
                      "Documents",
                      "Offboarding",
                    ].map((label) => ({ id: label, label, content: () => <p>{label} content</p> })),
                    ...(!readOnly
                      ? [
                          {
                            id: "privileged",
                            label: "Privileged",
                            content: () => <p>Privileged content</p>,
                          },
                        ]
                      : []),
                  ],
                }}
                record={rows[0]}
              />
              <AIChatPanel
                open={chat !== "closed"}
                docked={chat === "docked"}
                onClose={() => setChat("closed")}
                initialMessages={[
                  {
                    id: "long",
                    role: "assistant",
                    content: `${longValue}\nPreserved newline`,
                    timestamp: new Date("2026-10-17T12:00:00Z"),
                  },
                ]}
              />
            </div>
          </RBACProvider>
        </I18nProvider>
      </LumiereApiProvider>
    </QueryClientProvider>
  )
}
