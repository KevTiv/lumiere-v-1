"use client"

import type { ComponentProps } from "react"
import { ModulePageComposition } from "@lumiere/ui/pages/page-composition-host"

type OperationalPageCompositionProps = Pick<
  ComponentProps<typeof ModulePageComposition>,
  "title" | "actionTarget" | "sections"
> & { moduleId: "tasks" | "approvals" | "distributor" | "map" }

/** Keep the existing layout key while mounting insights after the page's fixed work. */
export function OperationalPageComposition(props: OperationalPageCompositionProps) {
  return <ModulePageComposition {...props} pageId="dashboard" placement="insights" />
}
