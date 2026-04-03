"use client"

import { POSPage } from "@lumiere/ui/pos/pos-page"
import { MissingOrganization } from "@lumiere/ui"
import { hasValidOrganizationId } from "@/lib/org-scoped"
import { usePOS } from "./use-pos"

interface PosClientProps {
  initialProducts?: Record<string, unknown>[]
  initialTerminals?: Record<string, unknown>[]
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
}: PosClientLoadedProps) {
  const pos = usePOS(
    BigInt(organizationId),
    initialProducts,
    initialTerminals
  )
  return <POSPage {...pos} />
}
