"use client"

import { useMemo, type ComponentProps } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView } from "@lumiere/ui/pages/module-view"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import type { ModuleConfig } from "@lumiere/ui/lib/module-types"
import type { WorkModule } from "@lumiere/query-hooks/hooks/work-board-model"
import { WorkBoardWorkspace } from "./work-board-workspace"
import {
  canReadRecordFollowups,
  canReadWorkflowWork,
} from "./work-board-permissions"

type ModuleWorkViewProps = ComponentProps<typeof ModuleView> & {
  organizationId: number
  workScope: WorkModule
}

/** Compose one shared Work workspace into the existing module navigation. */
export function ModuleWorkView({
  organizationId,
  workScope,
  config,
  ...props
}: ModuleWorkViewProps) {
  const { t } = useTranslation()
  const { checkPermission, permissionsReady } = useRBAC()
  const allowed =
    permissionsReady !== false &&
    (canReadWorkflowWork(checkPermission) ||
      (workScope !== "expenses" && canReadRecordFollowups(checkPermission)))
  const withWork = useMemo<ModuleConfig>(() => {
    if (!allowed) return config
    const label = t("workBoard.tab")
    return {
      ...config,
      tabs: [
        ...config.tabs,
        {
          id: "work",
          label,
          type: "custom",
          description: t("workBoard.description"),
          customContent: (
            <WorkBoardWorkspace
              organizationId={organizationId}
              scope={workScope}
              embedded
            />
          ),
        },
      ],
      ...(config.workspaceNav
        ? {
            workspaceNav: {
              ...config.workspaceNav,
              workspaces: [
                ...config.workspaceNav.workspaces,
                { id: "work", label, tabIds: ["work"] },
              ],
            },
          }
        : {}),
      ...(config.tabGroups
        ? { tabGroups: [...config.tabGroups, { label, tabIds: ["work"] }] }
        : {}),
    }
  }, [allowed, config, organizationId, t, workScope])
  return <ModuleView {...props} config={withWork} />
}
