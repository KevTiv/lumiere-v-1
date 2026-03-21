"use client"

import { useState } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/tabs"
import { Button } from "../components/button"
import { DashboardGrid } from "./dashboard-grid"
import { DashboardHeader } from "./dashboard-header"
import { EntityView } from "../entity-views/entity-view"
import { FormModal } from "../forms/form-modal"
import type { ModuleConfig } from "../lib/module-types"

interface ModuleViewProps {
  config: ModuleConfig
  /** Live data keyed by tab id — entity tabs receive data[tab.id] */
  data?: Record<string, Record<string, unknown>[]>
  /** Called when a create form is submitted: tabId, createAction, form values */
  onFormSubmit?: (tabId: string, action: string, data: Record<string, unknown>) => void
  /** Called when a table row is clicked: tabId, row record */
  onRowClick?: (tabId: string, row: Record<string, unknown>) => void
}

export function ModuleView({
  config,
  data = {},
  onFormSubmit,
  onRowClick,
}: ModuleViewProps) {
  const defaultTab = config.defaultTab ?? config.tabs[0]?.id ?? ""
  const [activeTab, setActiveTab] = useState(defaultTab)
  const [openForm, setOpenForm] = useState<string | null>(null)

  return (
    <div className="flex flex-col min-h-full gap-2">
      <DashboardHeader title={config.title} description={config.description} />

      <Tabs value={activeTab} onValueChange={setActiveTab} className={"flex-col flex"}>
        <TabsList variant="default" className="w-full flex flex-wrap justify-start max-w-fit gap-2">
          {config.tabs.map((tab, i) => (
            <TabsTrigger tabIndex={i} key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {config.tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="mt-6">
            {tab.type === "dashboard" && tab.sections && (
              <DashboardGrid sections={tab.sections} />
            )}

            {tab.type === "custom" && tab.customContent}

            {tab.type === "entity" && tab.entityConfig && (
              <div className="space-y-3">
                {tab.createForm && (
                  <div className="flex justify-end">
                    <Button size="lg" onClick={() => setOpenForm(tab.id)}>
                      {tab.createLabel ?? "New"}
                    </Button>
                  </div>
                )}

                <EntityView
                  config={tab.entityConfig}
                  data={data[tab.id] ?? []}
                  onRowClick={
                    onRowClick ? (row) => onRowClick(tab.id, row) : undefined
                  }
                />

                {tab.createForm && (
                  <FormModal
                    open={openForm === tab.id}
                    onOpenChange={(open) => !open && setOpenForm(null)}
                    config={tab.createForm}
                    onSubmit={(formData) => {
                      onFormSubmit?.(
                        tab.id,
                        tab.createAction ?? tab.id,
                        formData,
                      )
                    }}
                  />
                )}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
