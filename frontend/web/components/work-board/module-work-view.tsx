"use client"

import { useMemo, type ComponentProps } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView } from "@lumiere/ui/pages/module-view"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import {
  moduleWorkBoardTabId,
  type ModuleConfig,
} from "@lumiere/ui/lib/module-types"
import { WorkBoardWorkspace } from "./work-board-workspace"
import { workBoardSources } from "./work-board-config"
import {
  canReadRecordFollowups,
  canReadWorkflowWork,
} from "./work-board-permissions"

type ModuleWorkViewProps = ComponentProps<typeof ModuleView> & {
  organizationId: number
}

/** Compose one shared Work workspace into the existing module navigation. */
export function ModuleWorkView({
  organizationId,
  config,
  ...props
}: ModuleWorkViewProps) {
  const { t } = useTranslation()
  const { checkPermission, permissionsReady } = useRBAC()
  const work = config.workBoard
  const allowed =
    permissionsReady !== false &&
    work != null &&
    workBoardSources(work.scope, work.sources).some((source) =>
      source === "workflow"
        ? canReadWorkflowWork(checkPermission)
        : canReadRecordFollowups(checkPermission),
    )
  const withWork = useMemo<ModuleConfig>(() => {
    const tabId = moduleWorkBoardTabId(config)
    if (!allowed || !work || !tabId) return config
    // A reserved tab ID must not replace a module's existing record view.
    if (config.tabs.some((tab) => tab.id === tabId)) return config
    const label = work.label ?? t("workBoard.kanban")
    return {
      ...config,
      tabs: [
        ...config.tabs,
        {
          id: tabId,
          label,
          type: "custom",
          description: work.description ?? t("workBoard.description"),
          customContent: (
            <WorkBoardWorkspace
              organizationId={organizationId}
              scope={work.scope}
              sources={work.sources}
              initialView={work.initialView}
              defaultLayout={work.defaultLayout}
              workflowColumnOrder={work.workflowColumnOrder}
              workflowColumnLabels={work.workflowColumnLabels}
              title={label}
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
                { id: tabId, label, tabIds: [tabId] },
              ],
            },
          }
        : {}),
      ...(config.tabGroups
        ? { tabGroups: [...config.tabGroups, { label, tabIds: [tabId] }] }
        : {}),
    }
  }, [allowed, config, organizationId, t, work])
  // Permission loss or configuration removal must unmount a selected board,
  // including in modules that control their own active tab through the URL.
  const activeTab =
    props.activeTab != null &&
    !withWork.tabs.some((tab) => tab.id === props.activeTab)
      ? withWork.tabs.find((tab) => tab.id === withWork.defaultTab)?.id ??
        withWork.tabs[0]?.id
      : props.activeTab
  return <ModuleView {...props} activeTab={activeTab} config={withWork} />
}
