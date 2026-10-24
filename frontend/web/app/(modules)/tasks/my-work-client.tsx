"use client"

import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"
import { MissingOrganization, useRBAC } from "@lumiere/ui"
import { WorkBoardWorkspace } from "../../../components/work-board/work-board-workspace"

export function MyWorkClient({ organizationId }: { organizationId?: number }) {
  const { t } = useTranslation()
  const { checkPermission, permissionsReady } = useRBAC()
  if (organizationId == null || organizationId <= 0)
    return <MissingOrganization />
  return (
    <div className="min-w-0 space-y-4 p-4 md:p-6">
      {permissionsReady !== false &&
        checkPermission("module:projects", "read").allowed && (
          <Link
            className="inline-block text-sm font-medium underline"
            href="/tasks?source=projects"
          >
            {t("workBoard.projectTasks")}
          </Link>
        )}
      <WorkBoardWorkspace
        organizationId={organizationId}
        initialView="mine"
        defaultLayout="list"
      />
    </div>
  )
}
