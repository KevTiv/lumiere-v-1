"use client"

import { useTranslation } from "@lumiere/i18n"
import type { ImportMappingTemplateRow } from "@lumiere/query-hooks/hooks/import-mapping-templates"
import {
  parseImportMappingTemplateJson,
  templateId,
} from "@lumiere/query-hooks/hooks/import-mapping-templates"
import { BookmarkPlus, Trash2 } from "lucide-react"

import { Button } from "../components/button"
import { Input } from "../components/input"
import { Label } from "../components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select"

const NONE_VALUE = "__none__"

export type ImportTemplateControlsProps = {
  templates: ImportMappingTemplateRow[]
  selectedTemplateId: string | null
  onSelectedTemplateChange: (templateId: string | null) => void
  saveName: string
  onSaveNameChange: (name: string) => void
  onSaveTemplate: () => void
  onDeleteTemplate: () => void
  isSaving?: boolean
  isDeleting?: boolean
  showLoad?: boolean
  showSave?: boolean
}

export function ImportTemplateControls({
  templates,
  selectedTemplateId,
  onSelectedTemplateChange,
  saveName,
  onSaveNameChange,
  onSaveTemplate,
  onDeleteTemplate,
  isSaving = false,
  isDeleting = false,
  showLoad = true,
  showSave = false,
}: ImportTemplateControlsProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      {showLoad ? (
        <div className="space-y-2">
          <Label htmlFor="import-template-select">
            {t("common.importAssistant.savedTemplateLabel")}
          </Label>
          <Select
            value={selectedTemplateId ?? NONE_VALUE}
            onValueChange={(value) =>
              onSelectedTemplateChange(value === NONE_VALUE ? null : value)
            }
          >
            <SelectTrigger id="import-template-select">
              <SelectValue placeholder={t("common.importAssistant.savedTemplatePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>
                {t("common.importAssistant.noSavedTemplate")}
              </SelectItem>
              {templates.map((row) => (
                <SelectItem key={templateId(row)} value={templateId(row)}>
                  {row.name} ({row.useCount ?? row.use_count ?? 0}{" "}
                  {t("common.importAssistant.templateUses")})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedTemplateId ? (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onDeleteTemplate}
                disabled={isDeleting}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("common.importAssistant.deleteTemplate")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {showSave ? (
        <div className="space-y-2 border-t border-border pt-3">
          <Label htmlFor="import-template-name">
            {t("common.importAssistant.saveTemplateLabel")}
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="import-template-name"
              value={saveName}
              onChange={(e) => onSaveNameChange(e.target.value)}
              placeholder={t("common.importAssistant.saveTemplatePlaceholder")}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={onSaveTemplate}
              disabled={isSaving || !saveName.trim()}
            >
              <BookmarkPlus className="mr-2 h-4 w-4" />
              {isSaving
                ? t("common.importAssistant.savingTemplate")
                : t("common.importAssistant.saveTemplate")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function priorMappingsFromTemplate(
  row: ImportMappingTemplateRow | undefined,
): Record<string, string> | undefined {
  if (!row) return undefined
  const mapping = parseImportMappingTemplateJson(row)
  return Object.keys(mapping).length > 0 ? mapping : undefined
}

export function selectedTemplateRow(
  templates: ImportMappingTemplateRow[],
  selectedTemplateId: string | null,
): ImportMappingTemplateRow | undefined {
  if (!selectedTemplateId) return undefined
  return templates.find((row) => templateId(row) === selectedTemplateId)
}
