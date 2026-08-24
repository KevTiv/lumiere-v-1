"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { POSPage } from "@lumiere/ui/pos/pos-page"
import {
  DashboardHeader,
  EntityView,
  FormModal,
  MissingOrganization,
  mergeSelectOptionsForFields,
  posFormConfigs,
  posConfigsAdminTableConfig,
  posSessionsAdminTableConfig,
  posTerminalsAdminTableConfig,
  type FormConfig,
} from "@lumiere/ui"
import type { PosFormAction } from "@lumiere/ui"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@lumiere/ui/components/tabs"
import { Button } from "@lumiere/ui/components/button"
import { posModuleConfig } from "@/lib/module-dashboard-configs"
import { usePosModuleSubscription } from "@/lib/module-subscription-hooks"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import {
  posConfigRowsToSelectOptions,
  posSessionRowsToSelectOptions,
  posTerminalRowsToSelectOptions,
} from "@/lib/form-lookup"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { usePosLoyaltyPrograms } from "@lumiere/query-hooks/hooks/sales"
import { usePOS } from "./use-pos"
import type { PosConfig, PosSession, PosTerminal, Product } from "@lumiere/stdb/types"

interface PosClientProps {
  initialProducts?: Product[]
  initialTerminals?: PosTerminal[]
  initialConfigs?: PosConfig[]
  initialSessions?: PosSession[]
  organizationId?: number
}

type PosClientLoadedProps = Omit<PosClientProps, "organizationId"> & {
  organizationId: number
}

export function PosClient(props: PosClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }

  return <PosClientLoaded {...props} organizationId={props.organizationId} />
}

function PosClientLoaded({
  organizationId,
  initialProducts,
  initialTerminals,
  initialConfigs,
  initialSessions,
}: PosClientLoadedProps) {
  usePosModuleSubscription()
  const { t } = useTranslation()
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const moduleConfig = useMemo(() => posModuleConfig(t), [t])
  const [activeTab, setActiveTab] = useState("register")
  const [posAction, setPosAction] = useState<PosFormAction | null>(null)

  const pos = usePOS(
    orgId,
    operatingCompanyId,
    initialProducts,
    initialTerminals,
    initialConfigs,
    initialSessions,
  )

  const { data: loyaltyPrograms = [] } = usePosLoyaltyPrograms(orgId)

  const terminalOptions = useMemo(() => {
    const fromApi = posTerminalRowsToSelectOptions(pos.terminals)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("pos.admin.terminals.emptyMessage"), disabled: true }]
  }, [pos.terminals, t])

  const configOptions = useMemo(() => {
    const fromApi = posConfigRowsToSelectOptions(pos.configs)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("pos.admin.configs.emptyMessage"), disabled: true }]
  }, [pos.configs, t])

  const sessionOptions = useMemo(() => {
    const fromApi = posSessionRowsToSelectOptions(pos.sessions)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("pos.admin.sessions.emptyMessage"), disabled: true }]
  }, [pos.sessions, t])

  const posActionForm = useMemo((): FormConfig | null => {
    if (!posAction) return null
    const base = posFormConfigs(t)[posAction]
    if (posAction === "updateTerminal") {
      return mergeSelectOptionsForFields(base, { terminalId: terminalOptions })
    }
    if (posAction === "activateConfig" || posAction === "deactivateConfig" || posAction === "openSession") {
      return mergeSelectOptionsForFields(base, { configId: configOptions })
    }
    if (posAction === "computeTotals" || posAction === "closeSession") {
      return mergeSelectOptionsForFields(base, { sessionId: sessionOptions })
    }
    return base
  }, [posAction, t, terminalOptions, configOptions, sessionOptions])

  const handlePosActionSubmit = async (data: Record<string, unknown>) => {
    if (posAction === "createTerminal") await pos.createTerminal(data)
    else if (posAction === "updateTerminal") await pos.updatePrimaryTerminal(data)
    else if (posAction === "createConfig") await pos.createDefaultConfig(data)
    else if (posAction === "activateConfig") await pos.activateConfig(data)
    else if (posAction === "deactivateConfig") await pos.deactivateConfig(data)
    else if (posAction === "openSession") await pos.openSession(data)
    else if (posAction === "computeTotals") await pos.computeSessionTotals(data)
    else if (posAction === "closeSession") await pos.closeSession(data)
    setPosAction(null)
  }

  const adminActions: PosFormAction[] = [
    "createTerminal",
    "updateTerminal",
    "createConfig",
    "activateConfig",
    "deactivateConfig",
    "openSession",
    "computeTotals",
    "closeSession",
  ]

  return (
    <div className="flex h-full flex-col gap-4">
      <DashboardHeader title={moduleConfig.title} description={moduleConfig.description} />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          {moduleConfig.tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} data-testid={`pos-tab-${tab.id}`}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="register" className="mt-4 min-h-0 flex-1">
          <POSPage {...pos} onOpenPosAction={(action) => setPosAction(action as PosFormAction)} />
        </TabsContent>

        <TabsContent value="admin" className="mt-4 space-y-6 overflow-y-auto">
          <div className="rounded-lg border border-border p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("pos.admin.operations")}
            </p>
            <div className="flex flex-wrap gap-2">
              {adminActions.map((action) => (
                <Button
                  key={action}
                  size="sm"
                  variant="outline"
                  disabled={pos.isPosLifecyclePending}
                  onClick={() => setPosAction(action)}
                >
                  {posFormConfigs(t)[action].title}
                </Button>
              ))}
            </div>
            {loyaltyPrograms.length > 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {loyaltyPrograms.length} loyalty program(s) available — manage under Sales → Loyalty.
              </p>
            ) : null}
            {pos.posLifecycleError ? (
              <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                {pos.posLifecycleError}
              </p>
            ) : null}
          </div>

          <EntityView config={posTerminalsAdminTableConfig(t)} data={pos.terminals} />
          <EntityView config={posConfigsAdminTableConfig(t)} data={pos.configs} />
          <EntityView config={posSessionsAdminTableConfig(t)} data={pos.sessions} />
        </TabsContent>
      </Tabs>

      {posAction && posActionForm ? (
        <FormModal
          open
          onOpenChange={(open) => !open && setPosAction(null)}
          config={posActionForm}
          isPending={pos.isPosLifecyclePending}
          submitError={pos.posLifecycleError}
          onSubmit={handlePosActionSubmit}
        />
      ) : null}
    </div>
  )
}
