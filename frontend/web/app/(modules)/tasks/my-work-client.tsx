"use client"

import { MissingOrganization } from "@lumiere/ui"
import { DailyWorkWorkspace } from "../../../components/daily-work-workspace"

export function MyWorkClient({ organizationId }: { organizationId?: number }) {
  if (organizationId == null || organizationId <= 0)
    return <MissingOrganization />
  return (
    <div className="min-w-0 space-y-4 p-4 md:p-6">
      <DailyWorkWorkspace organizationId={organizationId} />
    </div>
  )
}
