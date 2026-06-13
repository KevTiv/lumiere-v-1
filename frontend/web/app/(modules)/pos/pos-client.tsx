"use client"

import { POSPage } from "@lumiere/ui/pos/pos-page"
import { FormModal, MissingOrganization, type FormConfig } from "@lumiere/ui"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { usePOS } from "./use-pos"
import { useState } from "react"

interface PosClientProps {
  initialProducts?: Record<string, unknown>[]
  initialTerminals?: Record<string, unknown>[]
  organizationId?: number
}

type PosClientLoadedProps = Omit<PosClientProps, "organizationId"> & {
  organizationId: number
}

type PosAction =
  | "createTerminal"
  | "updateTerminal"
  | "createConfig"
  | "activateConfig"
  | "deactivateConfig"
  | "openSession"
  | "computeTotals"
  | "closeSession"

const posActionForms: Record<PosAction, FormConfig> = {
  createTerminal: {
    id: "pos-create-terminal",
    title: "Create POS Terminal",
    submitLabel: "Create terminal",
    sections: [
      {
        id: "terminal",
        fields: [
          { id: "terminal-name", type: "text", name: "name", label: "Name", required: true },
          { id: "terminal-location", type: "text", name: "locationLabel", label: "Location label" },
          { id: "terminal-lat", type: "number", name: "latitude", label: "Latitude", width: "1/2" },
          { id: "terminal-lng", type: "number", name: "longitude", label: "Longitude", width: "1/2" },
        ],
      },
    ],
  },
  updateTerminal: {
    id: "pos-update-terminal",
    title: "Update Primary POS Terminal",
    description: "Updates the first terminal in the current terminal list.",
    submitLabel: "Update terminal",
    sections: [
      {
        id: "terminal-status",
        fields: [
          { id: "terminal-status-value", type: "text", name: "status", label: "Status", required: true },
          { id: "terminal-revenue", type: "number", name: "dailyRevenue", label: "Daily revenue", width: "1/2" },
          { id: "terminal-open-orders", type: "number", name: "openOrders", label: "Open orders", width: "1/2" },
        ],
      },
    ],
  },
  createConfig: {
    id: "pos-create-config",
    title: "Create POS Config",
    submitLabel: "Create config",
    sections: [
      {
        id: "config",
        fields: [
          { id: "config-name", type: "text", name: "name", label: "Name", required: true },
          { id: "config-active", type: "switch", name: "isActive", label: "Active by default", defaultValue: true },
        ],
      },
    ],
  },
  activateConfig: {
    id: "pos-activate-config",
    title: "Activate POS Config",
    submitLabel: "Activate",
    sections: [{ id: "config", fields: [{ id: "config-id", type: "number", name: "configId", label: "Config ID", required: true }] }],
  },
  deactivateConfig: {
    id: "pos-deactivate-config",
    title: "Deactivate POS Config",
    submitLabel: "Deactivate",
    sections: [{ id: "config", fields: [{ id: "config-id", type: "number", name: "configId", label: "Config ID", required: true }] }],
  },
  openSession: {
    id: "pos-open-session",
    title: "Open POS Session",
    submitLabel: "Open session",
    sections: [
      {
        id: "session",
        fields: [
          { id: "config-id", type: "number", name: "configId", label: "Config ID", required: true, width: "1/2" },
          { id: "opening-balance", type: "number", name: "openingBalance", label: "Opening balance", width: "1/2" },
        ],
      },
    ],
  },
  computeTotals: {
    id: "pos-compute-session-totals",
    title: "Compute POS Session Totals",
    submitLabel: "Compute totals",
    sections: [{ id: "session", fields: [{ id: "session-id", type: "number", name: "sessionId", label: "Session ID", required: true }] }],
  },
  closeSession: {
    id: "pos-close-session",
    title: "Close POS Session",
    submitLabel: "Close session",
    sections: [
      {
        id: "session",
        fields: [
          { id: "session-id", type: "number", name: "sessionId", label: "Session ID", required: true, width: "1/2" },
          { id: "closing-balance", type: "number", name: "closingBalance", label: "Closing balance", width: "1/2" },
        ],
      },
    ],
  },
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
}: PosClientLoadedProps) {
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const [posAction, setPosAction] = useState<PosAction | null>(null)
  const pos = usePOS(
    orgId,
    operatingCompanyId,
    initialProducts,
    initialTerminals
  )
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

  return (
    <>
      <POSPage {...pos} onOpenPosAction={(action) => setPosAction(action as PosAction)} />
      {posAction ? (
        <FormModal
          open
          onOpenChange={(open) => !open && setPosAction(null)}
          config={posActionForms[posAction]}
          isPending={pos.isPosLifecyclePending}
          submitError={pos.posLifecycleError}
          onSubmit={handlePosActionSubmit}
        />
      ) : null}
    </>
  )
}
