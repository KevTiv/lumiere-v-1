"use client"

import { Upload } from "lucide-react"
import { useSearchParams } from "next/navigation"
import type { SettingsExtraSection } from "@lumiere/ui"
import { CompanyAvailableHistory } from "../../../components/available-history"
import { DataImportWorkspace } from "../../../lib/data-import-workspace"

export function dataImportSection(
  organizationId: number,
): SettingsExtraSection {
  return {
    id: "imports",
    groupId: "data",
    title: "Data import",
    description:
      "Save CSV or Excel files, continue a saved import, or review what is already on file.",
    icon: Upload,
    content: <SettingsDataImport organizationId={organizationId} />,
  }
}

function SettingsDataImport({ organizationId }: { organizationId: number }) {
  const search = useSearchParams()?.toString()
  return (
    <DataImportWorkspace
      organizationId={organizationId}
      urlSearch={search}
      sourceHistory={
        <CompanyAvailableHistory
          organizationId={organizationId}
          urlSearch={search}
        />
      }
    />
  )
}
