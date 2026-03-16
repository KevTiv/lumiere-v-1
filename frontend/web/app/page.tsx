"use client"

import { useState, useMemo } from "react"
import {
  DashboardSidebar,
  DashboardHeader,
  DashboardGrid,
  FormModal,
  EntryTableViewer,
  useRBAC,
  SettingsModule,
  UserSwitcher,
  AIChatPanel,
  NotebookPanel,
  JournalPanel,
  TaskBoardView,
  ForensicsView,
  type DashboardConfig,
  type DashboardSection,
  type EntryData,
} from "@lumiere/ui"
import { dashboardConfigs } from "@/lib/demo-dashboard-config"
import { formConfigs } from "@/lib/demo-form-configs"
import {
  productTableConfig,
  sampleProducts,
  customerTableConfig,
  sampleCustomers
} from "@/lib/demo-entry-table-config"

function DashboardContent() {
  const [activeView, setActiveView] = useState("sales")
  const [activeForm, setActiveForm] = useState<string | null>(null)
  const [products, setProducts] = useState<EntryData[]>(sampleProducts)
  const [customers, setCustomers] = useState<EntryData[]>(sampleCustomers)
  const [isAIChatOpen, setIsAIChatOpen] = useState(false)
  const [isAIChatDocked, setIsAIChatDocked] = useState(false)
  const [isNotebookOpen, setIsNotebookOpen] = useState(false)
  const [isJournalOpen, setIsJournalOpen] = useState(false)
  const { checkPermission } = useRBAC()

  const handleDockToggle = () => {
    setIsAIChatDocked((prev) => !prev)
  }

  const baseConfig = dashboardConfigs[activeView] || dashboardConfigs.sales

  // Inject onClick handlers into quick-actions widgets
  const currentConfig: DashboardConfig = useMemo(() => {
    const actionToFormMap: Record<string, string> = {
      "new-order": "new-order",
      "reports": "generate-report",
      "team": "new-customer",
    }

    const sectionsWithHandlers: DashboardSection[] = baseConfig.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((widget) => {
        if (widget.type === "quick-actions") {
          return {
            ...widget,
            data: {
              ...widget.data,
              actions: widget.data.actions.map((action) => ({
                ...action,
                onClick: actionToFormMap[action.id]
                  ? () => setActiveForm(actionToFormMap[action.id])
                  : () => console.log(`Action clicked: ${action.id}`),
              })),
            },
          }
        }
        return widget
      }),
    }))

    return {
      ...baseConfig,
      sections: sectionsWithHandlers,
    }
  }, [baseConfig])

  const handleRefresh = () => {
    console.log("Refreshing dashboard...")
  }

  const handleExport = () => {
    setActiveForm("generate-report")
  }

  const handleNewOrder = () => {
    setActiveForm("new-order")
  }

  const handleFormSubmit = (data: Record<string, unknown>) => {
    console.log("Form submitted:", data)
    setActiveForm(null)
  }

  const handleProductSave = (updatedProduct: EntryData) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === updatedProduct.id ? updatedProduct : p))
    )
  }

  const handleProductDelete = (product: EntryData) => {
    if (confirm("Are you sure you want to delete this product?")) {
      setProducts((prev) => prev.filter((p) => p.id !== product.id))
    }
  }

  const handleCustomerSave = (updatedCustomer: EntryData) => {
    setCustomers((prev) =>
      prev.map((c) => (c.id === updatedCustomer.id ? updatedCustomer : c))
    )
  }

  const handleCustomerDelete = (customer: EntryData) => {
    if (confirm("Are you sure you want to delete this customer?")) {
      setCustomers((prev) => prev.filter((c) => c.id !== customer.id))
    }
  }

  const currentFormConfig = activeForm ? formConfigs[activeForm] : null

  // Check view permissions
  const canViewInventory = checkPermission("dashboard:inventory", "read").allowed
  const canViewCustomers = checkPermission("dashboard:customers", "read").allowed

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <DashboardSidebar
        activeView={activeView}
        onViewChange={setActiveView}
        forceCollapsed={isAIChatDocked || isNotebookOpen}
        onOpenJournal={() => setIsJournalOpen(true)}
        onOpenNotebook={() => setIsNotebookOpen(true)}
        onOpenAIChat={() => setIsAIChatOpen(true)}
      />

      <main className="flex-1 overflow-auto scroll-smooth">
        <div className="p-6 lg:p-8 min-w-max">
          {/* User Switcher for demo purposes */}
          <div className="flex items-center justify-between mb-6">
            <DashboardHeader
              title={activeView === "settings" ? "Settings" : currentConfig.title}
              description={activeView === "settings" ? "Manage your account and system configuration" : currentConfig.description}
              onRefresh={handleRefresh}
              onExport={handleExport}
            />
            <UserSwitcher />
          </div>

          {/* Settings Module */}
          {activeView === "settings" ? (
            <SettingsModule />
          ) : activeView === "tasks" ? (
            <TaskBoardView className="h-[calc(100vh-12rem)]" />
          ) : activeView === "forensics" ? (
            <ForensicsView className="h-[calc(100vh-12rem)]" />
          ) : (
            <>
              <DashboardGrid sections={currentConfig.sections} />

          {/* Entry Table Viewers */}
              {activeView === "inventory" && canViewInventory && (
                <div className="mt-8">
                  <EntryTableViewer
                    config={productTableConfig}
                    data={products}
                    onSave={handleProductSave}
                    onDelete={handleProductDelete}
                    onAdd={() => setActiveForm("new-order")}
                  />
                </div>
              )}

              {activeView === "customers" && canViewCustomers && (
                <div className="mt-8">
                  <EntryTableViewer
                    config={customerTableConfig}
                    data={customers}
                    onSave={handleCustomerSave}
                    onDelete={handleCustomerDelete}
                    onAdd={() => setActiveForm("new-customer")}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {currentFormConfig && (
        <FormModal
          open={!!activeForm}
          onOpenChange={(open) => !open && setActiveForm(null)}
          config={currentFormConfig}
          onSubmit={handleFormSubmit}
        />
      )}

      {/* AI Chat Panel — floating or docked */}
      <AIChatPanel
        open={isAIChatOpen}
        onClose={() => { setIsAIChatOpen(false); setIsAIChatDocked(false) }}
        docked={isAIChatDocked}
        onDockToggle={handleDockToggle}
        context={{ activeView }}
        config={{
          title: "ERP Assistant",
          welcomeMessage: "Ask questions about your sales, inventory, customers, or use @ commands for quick actions.",
          placeholder: "Ask anything... Type @ for commands",
        }}
      />

      {/* Notebook Panel for ML/Reports */}
      <NotebookPanel
        open={isNotebookOpen}
        onClose={() => setIsNotebookOpen(false)}
        onAIChat={(_message) => {
          setIsAIChatOpen(true)
        }}
        dataContext={{
          sales: products,
          inventory: products,
          customers: customers,
        }}
      />

      {/* Journal Panel */}
      <JournalPanel
        open={isJournalOpen}
        onClose={() => setIsJournalOpen(false)}
      />
    </div>
  )
}

export default function DashboardPage() {
  return <DashboardContent />
}
