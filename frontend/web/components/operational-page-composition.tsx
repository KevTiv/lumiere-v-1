"use client"

import type { ComponentProps } from "react"
import { ModulePageComposition } from "@lumiere/ui/pages/page-composition-host"

type OperationalPageCompositionProps = Pick<
  ComponentProps<typeof ModulePageComposition>,
  "title" | "actionTarget" | "sections" | "children" | "active"
> & { moduleId: "tasks" | "approvals" | "distributor" | "map" }

/** Native work and added widgets share one layout under the existing page key. */
export function OperationalPageComposition(
  props: OperationalPageCompositionProps,
) {
  return (
    <ModulePageComposition {...props} pageId="dashboard" placement="content" />
  )
}
