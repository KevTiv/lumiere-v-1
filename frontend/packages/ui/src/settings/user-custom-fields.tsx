"use client"

import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { useErpSession } from "@lumiere/erp-session"
import { stdbBrowserQuery } from "@lumiere/stdb/browser-http"
import { useTranslation } from "@lumiere/i18n"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Plus,
  Trash2,
  BookMarked,
  Sparkles,
  Target,
  TrendingUp,
  Clock,
  Hash,
  Star,
  Loader2,
} from "lucide-react"
import type { FieldType, CreateFormFieldParams } from "../forms/config/types"
import { generateCustomFieldId } from "../forms/config/types"
import { useUserCustomFields } from "../forms/hooks/use-form-config"

const simpleFieldTypes: {
  value: FieldType
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { value: "Text", label: "Text", icon: Sparkles },
  { value: "Number", label: "Number", icon: Hash },
  { value: "Rating", label: "Rating (1-5)", icon: Star },
  { value: "Slider", label: "Scale (1-10)", icon: TrendingUp },
  { value: "Checkbox", label: "Yes/No", icon: Target },
  { value: "Time", label: "Time", icon: Clock },
]

type FormConfigOption = {
  id: number
  moduleId: string
  formId: string
  name: string
}

type NewFieldDraft = {
  label: string
  type: FieldType
  description?: string
  validation?: { min?: number; max?: number }
}

const EMPTY_FIELD: NewFieldDraft = { label: "", type: "Text" }

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function slugifyLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

interface UserCustomFieldsProps {
  className?: string
}

export function UserCustomFields({ className }: UserCustomFieldsProps) {
  const { t } = useTranslation()
  const { organizationId } = useErpSession()
  const [formOptions, setFormOptions] = useState<FormConfigOption[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState<number>(0)
  const [formsLoading, setFormsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [newField, setNewField] = useState<NewFieldDraft>(EMPTY_FIELD)

  const { customFields, addCustomField, removeCustomField, isLoading } = useUserCustomFields(
    selectedConfigId,
  )

  useEffect(() => {
    if (!organizationId) {
      setFormOptions([])
      setSelectedConfigId(0)
      setFormsLoading(false)
      return
    }

    let cancelled = false

    async function loadFormConfigs() {
      setFormsLoading(true)
      try {
        const rows = await stdbBrowserQuery("form-configs")
        if (cancelled) return

        const options = rows
          .filter(
            (row) =>
              Number(row.organizationId ?? row.organization_id ?? 0) === organizationId &&
              (row.isActive ?? row.is_active) !== false,
          )
          .map((row) => ({
            id: Number(row.id ?? 0),
            moduleId: String(row.moduleId ?? row.module_id ?? ""),
            formId: String(row.formId ?? row.form_id ?? ""),
            name: String(row.name ?? ""),
          }))
          .filter((o) => o.id > 0)
          .sort((a, b) => a.name.localeCompare(b.name))

        setFormOptions(options)
        setSelectedConfigId((prev) =>
          prev && options.some((o) => o.id === prev) ? prev : (options[0]?.id ?? 0),
        )
      } catch (e) {
        if (!cancelled) {
          toast.error(errorMessage(e, t("settings.customFields.loadError")))
          setFormOptions([])
        }
      } finally {
        if (!cancelled) setFormsLoading(false)
      }
    }

    void loadFormConfigs()
    return () => {
      cancelled = true
    }
  }, [organizationId, t])

  const selectedForm = useMemo(
    () => formOptions.find((o) => o.id === selectedConfigId) ?? null,
    [formOptions, selectedConfigId],
  )

  function handleAddField() {
    setNewField(EMPTY_FIELD)
    setIsDialogOpen(true)
  }

  async function handleSaveField() {
    if (!newField.label.trim() || !selectedConfigId) return

    const slug = slugifyLabel(newField.label)
    if (!slug) {
      toast.error(t("settings.customFields.fieldKeyRequired"))
      return
    }

    const maxOrder = Math.max(0, ...customFields.map((f) => f.order))
    const params: CreateFormFieldParams = {
      fieldId: generateCustomFieldId(slug),
      name: slug,
      label: newField.label.trim(),
      fieldType: newField.type,
      description: newField.description,
      placeholder: undefined,
      defaultValue: undefined,
      options: [],
      validation: {
        required: false,
        min: newField.validation?.min,
        max: newField.validation?.max,
      },
      aiSuggestions: [],
      order: maxOrder + 1,
      isSystem: false,
      isEnabled: true,
      category: undefined,
      showInList: false,
      width: "Full",
      sectionId: undefined,
    }

    try {
      setIsSaving(true)
      await addCustomField(params)
      toast.success(t("settings.customFields.saved"))
      setIsDialogOpen(false)
      setNewField(EMPTY_FIELD)
    } catch (e) {
      toast.error(errorMessage(e, t("settings.customFields.saveError")))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDeleteField(fieldId: string) {
    try {
      setIsSaving(true)
      await removeCustomField(fieldId)
      toast.success(t("settings.customFields.deleted"))
    } catch (e) {
      toast.error(errorMessage(e, t("settings.customFields.deleteError")))
    } finally {
      setIsSaving(false)
    }
  }

  function updateNewField(patch: Partial<NewFieldDraft>) {
    setNewField((prev) => ({ ...prev, ...patch }))
  }

  return (
    <div className={cn("space-y-6", className)}>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning/10">
              <BookMarked className="h-5 w-5 text-warning" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base">{t("settings.customFields.title")}</CardTitle>
              <CardDescription>{t("settings.customFields.description")}</CardDescription>
            </div>
            <Button
              size="sm"
              onClick={handleAddField}
              className="gap-2"
              disabled={!selectedConfigId || isSaving}
            >
              <Plus className="h-4 w-4" />
              {t("settings.customFields.addField")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 max-w-md">
            <Label>{t("settings.customFields.targetForm")}</Label>
            <Select
              value={selectedConfigId ? String(selectedConfigId) : undefined}
              onValueChange={(v) => setSelectedConfigId(Number(v))}
              disabled={formsLoading || formOptions.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    formsLoading
                      ? t("common.loading")
                      : t("settings.customFields.selectFormPlaceholder")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {formOptions.map((opt) => (
                  <SelectItem key={opt.id} value={String(opt.id)}>
                    {opt.name} ({opt.moduleId}/{opt.formId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedForm ? (
              <p className="text-xs text-muted-foreground">
                {t("settings.customFields.personalHint")}
              </p>
            ) : null}
          </div>

          {formsLoading || isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">{t("common.loading")}</span>
            </div>
          ) : formOptions.length === 0 ? (
            <EmptyState
              title={t("settings.customFields.noFormConfigs")}
              hint={t("settings.customFields.noFormConfigsHint")}
            />
          ) : customFields.length === 0 ? (
            <EmptyState
              title={t("settings.customFields.noFields")}
              hint={t("settings.customFields.noFieldsHint")}
            />
          ) : (
            <div className="space-y-3">
              {customFields.map((field) => {
                const FieldIcon =
                  simpleFieldTypes.find((ft) => ft.value === field.type)?.icon ?? Sparkles
                return (
                  <div
                    key={field.fieldId}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                      field.isEnabled
                        ? "bg-card border-border"
                        : "bg-muted/50 border-transparent opacity-60",
                    )}
                  >
                    <div className="p-2 rounded-lg bg-muted">
                      <FieldIcon className="h-4 w-4 text-muted-foreground" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{field.label}</span>
                        <Badge variant="secondary" className="text-xs capitalize">
                          {field.type}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {field.fieldId}
                        </Badge>
                      </div>
                      {field.description ? (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {field.description}
                        </p>
                      ) : null}
                    </div>

                    <Switch checked={field.isEnabled} disabled aria-readonly />

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive/90"
                      disabled={isSaving}
                      onClick={() => void handleDeleteField(field.fieldId)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.customFields.addTitle")}</DialogTitle>
            <DialogDescription>{t("settings.customFields.createDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="field-label">{t("settings.customFields.fieldLabel")}</Label>
              <Input
                id="field-label"
                value={newField.label}
                onChange={(e) => updateNewField({ label: e.target.value })}
                placeholder={t("settings.customFields.fieldLabelPlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="field-type">{t("settings.customFields.fieldType")}</Label>
              <Select
                value={newField.type}
                onValueChange={(value) => updateNewField({ type: value as FieldType })}
              >
                <SelectTrigger id="field-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {simpleFieldTypes.map((type) => {
                    const Icon = type.icon
                    return (
                      <SelectItem key={type.value} value={type.value}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          {type.label}
                        </div>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="field-description">
                {t("settings.customFields.descriptionOptional")}
              </Label>
              <Input
                id="field-description"
                value={newField.description ?? ""}
                onChange={(e) => updateNewField({ description: e.target.value })}
                placeholder={t("settings.customFields.descriptionPlaceholder")}
              />
            </div>

            {(newField.type === "Slider" || newField.type === "Number") && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="min-value">{t("settings.customFields.minValue")}</Label>
                  <Input
                    id="min-value"
                    type="number"
                    value={newField.validation?.min ?? 0}
                    onChange={(e) =>
                      updateNewField({
                        validation: {
                          ...newField.validation,
                          min: Number.parseInt(e.target.value, 10) || 0,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-value">{t("settings.customFields.maxValue")}</Label>
                  <Input
                    id="max-value"
                    type="number"
                    value={newField.validation?.max ?? 10}
                    onChange={(e) =>
                      updateNewField({
                        validation: {
                          ...newField.validation,
                          max: Number.parseInt(e.target.value, 10) || 10,
                        },
                      })
                    }
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void handleSaveField()} disabled={!newField.label || isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("settings.customFields.addField")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-50" />
      <p className="text-sm">{title}</p>
      <p className="text-xs mt-1">{hint}</p>
    </div>
  )
}
