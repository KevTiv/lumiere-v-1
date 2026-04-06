"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import { useTranslation } from "@lumiere/i18n"
import { toast } from "sonner"
import { useErpSession } from "@lumiere/erp-session"
import {
  seedOrganizationFormConfigs,
  addFormField,
  setFormRoleConfig,
  updateFormField,
  deleteFormField,
  initializeDefaultFormConfigs,
  type CreateFormFieldParams as StdbCreateFormFieldParams,
  type UpdateFormFieldParams,
} from "@lumiere/stdb/client-ui-bridge"
import { cn } from "@/lib/utils"
import { useRBAC } from "@/lib/rbac-context"
import { formRegistry } from "../forms/config/registry"
import type { FormRegistryEntry, FormModuleMetadata, FieldType, ParsedFormField } from "../forms/config/types"
import { generateCustomFieldId, parseRoleConfig } from "../forms/config/types"
import { useFormConfiguration } from "../forms/hooks/use-form-config"
import { ConfigurableForm } from "../forms/components/configurable-form"
import { pushRegistryFormToDatabase } from "../forms/utils/push-registry-form"
import { formValidationToStdb } from "../forms/utils/stdb-field-params"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Plus,
  GripVertical,
  Pencil,
  Trash2,
  Copy,
  Eye,
  EyeOff,
  MoreVertical,
  Save,
  Search,
  ChevronRight,
  AlertCircle,
  RotateCcw,
  Download,
  Upload,
  LayoutGrid,
  List,
  // Module icons
  BookMarked,
  FileSearch,
  Users,
  ShoppingCart,
  Package,
  Landmark,
  ShoppingBag,
  FolderKanban,
  File,
  Wrench,
  LifeBuoy,
  Receipt,
  Calendar,
  RefreshCw,
  FileText,
  BarChart,
  // Form icons
  UserPlus,
  Settings2,
} from "lucide-react"

// ── Icon map — module-level constant (never re-created on render) ────────────
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  BookMarked,
  FileSearch,
  Users,
  ShoppingCart,
  Package,
  Landmark,
  ShoppingBag,
  FolderKanban,
  File,
  Wrench,
  LifeBuoy,
  Receipt,
  Calendar,
  RefreshCw,
  FileText,
  BarChart,
  UserPlus,
  Settings2,
}

function getIcon(name: string) {
  return ICON_MAP[name] ?? Settings2
}

interface UnifiedFormConfigSettingsProps {
  className?: string
}

type ViewMode = "grid" | "list"

export function UnifiedFormConfigSettings({ className }: UnifiedFormConfigSettingsProps) {
  const { t } = useTranslation()
  const [isViewingSettings, setIsViewingSettings] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedModule, setSelectedModule] = useState<string | null>(null)
  const [selectedForm, setSelectedForm] = useState<FormRegistryEntry | null>(null)

  const modules = useMemo(() => formRegistry.getModules(), [])

  const moduleForms = useMemo(() => {
    if (!selectedModule) return []
    return formRegistry.getByModule(selectedModule)
  }, [selectedModule])

  const filteredModules = useMemo(() => {
    if (!searchQuery) return modules
    return modules.filter((m: FormModuleMetadata) =>
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.description.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [modules, searchQuery])

  const handleModuleSelect = (moduleId: string) => {
    setSelectedModule(moduleId)
    setSelectedForm(null)
  }

  const handleFormSelect = (form: FormRegistryEntry) => {
    setSelectedForm(form)
  }

  const handleBackToModules = () => {
    setSelectedModule(null)
    setSelectedForm(null)
    setIsViewingSettings(false)
  }

  const handleBackToForms = () => {
    setSelectedForm(null)
  }

  // ── Module Selection View ───────────────────────────────────────────────────
  if (!selectedModule) {
    return (
      <div className={cn("space-y-6", className)}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">{t("settings.formConfig.title")}</h3>
            <p className="text-sm text-muted-foreground">{t("settings.formConfig.description")}</p>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("settings.formConfig.searchPlaceholder")}
              className="pl-9 w-[250px]"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredModules.map((module: FormModuleMetadata) => {
            const Icon = getIcon(module.icon)
            return (
              <Card
                key={module.id}
                className="cursor-pointer transition-all hover:border-primary/50"
                onClick={() => handleModuleSelect(module.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <Badge variant="secondary">
                      {t("settings.formConfig.formsCount", { count: module.forms.length })}
                    </Badge>
                  </div>
                  <CardTitle className="text-base mt-3">{module.name}</CardTitle>
                  <CardDescription className="text-sm">{module.description}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <Button variant="ghost" className="w-full justify-between" size="sm">
                    {t("settings.formConfig.configureForms")}
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Form Selection View ─────────────────────────────────────────────────────
  if (!selectedForm) {
    const module = modules.find((m: FormModuleMetadata) => m.id === selectedModule)

    return (
      <div className={cn("space-y-6", className)}>
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={handleBackToModules} className={cn("gap-2", isViewingSettings ? "hidden" : "")}>
            <ChevronRight className="h-4 w-4 rotate-180" />
            {t("settings.formConfig.backToModules")}
          </Button>
          <div>
            <h3 className="text-lg font-semibold">
              {t("settings.formConfig.moduleForms", { name: module?.name })}
            </h3>
            <p className="text-sm text-muted-foreground">{t("settings.formConfig.selectForm")}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {moduleForms.map((form: FormRegistryEntry) => {
            const Icon = getIcon(form.icon)
            return (
              <Card
                key={form.formId}
                className="cursor-pointer transition-all hover:border-primary/50"
                onClick={() => { handleFormSelect(form); setIsViewingSettings(true) }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <Badge variant="outline">{form.category}</Badge>
                  </div>
                  <CardTitle className="text-base mt-3">{form.name}</CardTitle>
                  <CardDescription className="text-sm">{form.description}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <Button variant="ghost" className="w-full justify-between" size="sm">
                    {t("settings.formConfig.configureFields")}
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Form Configuration View ─────────────────────────────────────────────────
  return (
    <FormConfigurationDetail
      className={className}
      formEntry={selectedForm}
      onBack={handleBackToForms}
    />
  )
}

interface FormConfigurationDetailProps {
  className?: string
  formEntry: FormRegistryEntry
  onBack: () => void
}

const FIELD_TYPES_FOR_CUSTOM: FieldType[] = [
  "Text",
  "Textarea",
  "Number",
  "Select",
  "MultiSelect",
  "Date",
  "DateTime",
  "Checkbox",
  "Switch",
  "Radio",
  "Rating",
  "Tags",
]

function FormConfigurationDetail({ className, formEntry, onBack }: FormConfigurationDetailProps) {
  const { t } = useTranslation()
  const { checkPermission } = useRBAC()
  const { organizationId, connected } = useErpSession()
  const canEditForms = checkPermission("admin:roles", "update").allowed

  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const [isFieldDialogOpen, setIsFieldDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [fieldKey, setFieldKey] = useState("")
  const [fieldLabel, setFieldLabel] = useState("")
  const [fieldType, setFieldType] = useState<FieldType>("Text")
  const [fieldRequired, setFieldRequired] = useState(false)

  const {
    config: mergedConfig,
    isLoading,
    error,
    refetch,
    sourceRoleConfigs,
    dbConfigurationId,
  } = useFormConfiguration({
    moduleId: formEntry.moduleId,
    formId: formEntry.formId,
    organizationId: organizationId ?? 0,
    forAdminSettings: true,
  })

  const roleConfigsForTabs = useMemo(() => {
    const fromDb: Record<string, ReturnType<typeof parseRoleConfig>> = {}
    for (const rc of sourceRoleConfigs) {
      fromDb[rc.roleId] = parseRoleConfig(rc)
    }
    if (Object.keys(fromDb).length > 0) return fromDb
    const def = formEntry.defaultConfig().roleConfigs
    if (!def) return {}
    const out: Record<string, ReturnType<typeof parseRoleConfig>> = {}
    for (const [k, v] of Object.entries(def)) {
      out[k] = {
        enabledFields: [...v.enabledFields],
        requiredFields: [...v.requiredFields],
        defaultPrompts: [...(v.defaultPrompts ?? [])],
      }
    }
    return out
  }, [sourceRoleConfigs, formEntry])

  const roleKeysForPreview = useMemo(() => Object.keys(roleConfigsForTabs), [roleConfigsForTabs])
  const [previewRoleId, setPreviewRoleId] = useState("role-admin")
  useEffect(() => {
    if (roleKeysForPreview.length === 0) return
    if (!roleKeysForPreview.includes(previewRoleId)) {
      setPreviewRoleId(roleKeysForPreview[0])
    }
  }, [roleKeysForPreview, previewRoleId])

  const handleSeed = useCallback(async () => {
    if (!organizationId) {
      toast.error(t("settings.formConfig.noOrganization"))
      return
    }
    try {
      setIsSaving(true)
      await seedOrganizationFormConfigs(BigInt(organizationId))
      toast.success(t("settings.formConfig.seedSuccess"))
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.formConfig.seedError"))
    } finally {
      setIsSaving(false)
    }
  }, [organizationId, refetch, t])

  const handlePushRegistry = useCallback(async () => {
    if (!organizationId) {
      toast.error(t("settings.formConfig.noOrganization"))
      return
    }
    if (!canEditForms) {
      toast.error(t("settings.formConfig.noPermission"))
      return
    }
    try {
      setIsSaving(true)
      await pushRegistryFormToDatabase(organizationId, formEntry)
      toast.success(t("settings.formConfig.pushRegistrySuccess"))
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.formConfig.pushRegistryError"))
    } finally {
      setIsSaving(false)
    }
  }, [organizationId, canEditForms, formEntry, refetch, t])

  const handleInitJournalForensic = useCallback(async () => {
    if (!organizationId) {
      toast.error(t("settings.formConfig.noOrganization"))
      return
    }
    try {
      setIsSaving(true)
      await initializeDefaultFormConfigs(BigInt(organizationId))
      toast.success(t("settings.formConfig.initDefaultsSuccess"))
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.formConfig.initDefaultsError"))
    } finally {
      setIsSaving(false)
    }
  }, [organizationId, refetch, t])

  const handleToggleFieldEnabled = useCallback(
    async (field: ParsedFormField, next: boolean) => {
      if (!organizationId || !dbConfigurationId || !canEditForms) return
      try {
        setIsSaving(true)
        await updateFormField(BigInt(organizationId), BigInt(dbConfigurationId), field.fieldId, {
          isEnabled: next,
        } as UpdateFormFieldParams)
        toast.success(t("settings.formConfig.fieldEnabledUpdated"))
        refetch()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("settings.formConfig.fieldUpdateError"))
      } finally {
        setIsSaving(false)
      }
    },
    [organizationId, dbConfigurationId, canEditForms, refetch, t],
  )

  const handleDeleteField = useCallback(
    async (field: ParsedFormField) => {
      if (!organizationId || !dbConfigurationId || !canEditForms) return
      if (field.isSystem) return
      try {
        setIsSaving(true)
        await deleteFormField(BigInt(organizationId), BigInt(dbConfigurationId), field.fieldId)
        toast.success(t("settings.formConfig.fieldDeleted"))
        refetch()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("settings.formConfig.fieldDeleteError"))
      } finally {
        setIsSaving(false)
      }
    },
    [organizationId, dbConfigurationId, canEditForms, refetch, t],
  )

  const handleAddCustomField = useCallback(async () => {
    if (!organizationId || !dbConfigurationId) {
      toast.error(t("settings.formConfig.needDbConfig"))
      return
    }
    if (!canEditForms) {
      toast.error(t("settings.formConfig.noPermission"))
      return
    }
    const slug = fieldKey.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_")
    if (!slug) {
      toast.error(t("settings.formConfig.fieldKeyRequired"))
      return
    }
    const fieldId = generateCustomFieldId(slug)
    const maxOrder = Math.max(0, ...(mergedConfig?.fields.map(f => f.order) ?? [0]))
    const params = {
      fieldId,
      name: slug,
      label: fieldLabel.trim() || slug,
      fieldType: { tag: fieldType },
      description: undefined,
      placeholder: undefined,
      defaultValue: undefined,
      options: [],
      validation: formValidationToStdb({ required: fieldRequired }),
      aiSuggestions: [],
      order: maxOrder + 1,
      isSystem: false,
      isEnabled: true,
      category: undefined,
      showInList: false,
      width: { tag: "Full" as const },
      sectionId: undefined,
    } as unknown as StdbCreateFormFieldParams

    try {
      setIsSaving(true)
      await addFormField(BigInt(organizationId), BigInt(dbConfigurationId), params)

      for (const rc of sourceRoleConfigs) {
        const parsed = parseRoleConfig(rc)
        const enabled = parsed.enabledFields.includes(fieldId)
          ? parsed.enabledFields
          : [...parsed.enabledFields, fieldId]
        const required =
          fieldRequired && !parsed.requiredFields.includes(fieldId)
            ? [...parsed.requiredFields, fieldId]
            : parsed.requiredFields
        await setFormRoleConfig(BigInt(organizationId), BigInt(dbConfigurationId), {
          roleId: rc.roleId,
          enabledFields: enabled,
          requiredFields: required,
          defaultPrompts: parsed.defaultPrompts,
        })
      }

      toast.success(t("settings.formConfig.customFieldAdded"))
      setIsFieldDialogOpen(false)
      setFieldKey("")
      setFieldLabel("")
      setFieldType("Text")
      setFieldRequired(false)
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.formConfig.addFieldError"))
    } finally {
      setIsSaving(false)
    }
  }, [
    organizationId,
    dbConfigurationId,
    canEditForms,
    fieldKey,
    fieldLabel,
    fieldType,
    fieldRequired,
    mergedConfig?.fields,
    sourceRoleConfigs,
    refetch,
    t,
  ])

  const fields = mergedConfig?.fields ?? []

  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={onBack} className="gap-2">
          <ChevronRight className="h-4 w-4 rotate-180" />
          {t("settings.formConfig.backToForms")}
        </Button>
        <div className="flex-1">
          <h3 className="text-lg font-semibold">{formEntry.name}</h3>
          <p className="text-sm text-muted-foreground">{formEntry.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {organizationId && dbConfigurationId === 0 && (
            <>
              <Button
                variant="default"
                size="sm"
                className="gap-2"
                disabled={isSaving || !connected || !canEditForms}
                onClick={() => void handlePushRegistry()}
              >
                <Save className={cn("h-4 w-4", isSaving && "animate-spin")} />
                {t("settings.formConfig.createFromRegistry")}
              </Button>
              <Button variant="outline" size="sm" className="gap-2" disabled={isSaving || !connected} onClick={() => void handleSeed()}>
                <RefreshCw className={cn("h-4 w-4", isSaving && "animate-spin")} />
                {t("settings.formConfig.seedDatabase")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={isSaving || !connected}
                onClick={() => void handleInitJournalForensic()}
              >
                {t("settings.formConfig.initJournalForensic")}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="gap-2" onClick={() => refetch()}>
            <RotateCcw className="h-4 w-4" />
            {t("settings.formConfig.refresh")}
          </Button>
        </div>
      </div>

      {!organizationId && (
        <div className="flex items-center gap-2 p-3 bg-muted/50 border rounded-md text-sm">
          <AlertCircle className="h-4 w-4" />
          {t("settings.formConfig.noOrganization")}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/25 rounded-md text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {dbConfigurationId === 0 && organizationId ? (
        <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/25 rounded-md text-sm">
          <AlertCircle className="h-4 w-4 text-warning shrink-0" />
          {t("settings.formConfig.registryOnlyHint")}
        </div>
      ) : null}

      <Tabs defaultValue="fields" className="w-full flex flex-col">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 lg:max-w-3xl">
          <TabsTrigger value="fields">{t("settings.formConfig.tabs.fields")}</TabsTrigger>
          <TabsTrigger value="roles">{t("settings.formConfig.tabs.roles")}</TabsTrigger>
          <TabsTrigger value="preview">{t("settings.formConfig.tabs.preview")}</TabsTrigger>
          <TabsTrigger value="import">{t("settings.formConfig.tabs.importExport")}</TabsTrigger>
        </TabsList>

        <TabsContent value="fields" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant={viewMode === "grid" ? "default" : "outline"}
                size="icon"
                onClick={() => setViewMode("grid")}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "outline"}
                size="icon"
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
            <Button
              onClick={() => setIsFieldDialogOpen(true)}
              className="gap-2"
              disabled={!canEditForms || !dbConfigurationId || isLoading}
            >
              <Plus className="h-4 w-4" />
              {t("settings.formConfig.addField")}
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-40 border rounded-lg text-muted-foreground text-sm">
              {t("common.loading")}
            </div>
          ) : (
            <ScrollArea className="h-125 border rounded-lg p-4">
              <div className={viewMode === "grid" ? "grid gap-4 md:grid-cols-2" : "space-y-3"}>
                {fields.map((field: ParsedFormField, index: number) => (
                  <FieldConfigCard
                    key={field.fieldId}
                    field={field}
                    index={index}
                    canMutate={canEditForms && !!dbConfigurationId && !isSaving}
                    onEdit={() => setIsFieldDialogOpen(true)}
                    onToggleEnabled={(f, next) => void handleToggleFieldEnabled(f, next)}
                    onDelete={(f) => void handleDeleteField(f)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="roles" className="space-y-4">
          {Object.keys(roleConfigsForTabs).length > 0 && (
            <div className="space-y-4">
              {Object.entries(roleConfigsForTabs).map(([roleId, config]) => (
                <Card key={roleId}>
                  <CardHeader>
                    <CardTitle className="text-base capitalize">
                      {roleId.replace("role-", "")}
                    </CardTitle>
                    <CardDescription>
                      {t("settings.formConfig.roleConfig.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label className="text-sm font-medium">
                        {t("settings.formConfig.roleConfig.enabledFields")}
                      </Label>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {config.enabledFields.map((fieldId: string) => (
                          <Badge key={fieldId} variant="secondary">{fieldId}</Badge>
                        ))}
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">
                        {t("settings.formConfig.roleConfig.requiredFields")}
                      </Label>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {config.requiredFields.map((fieldId: string) => (
                          <Badge key={fieldId} variant="default">{fieldId}</Badge>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="preview" className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("settings.formConfig.preview.description")}</p>
          {roleKeysForPreview.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-sm shrink-0">{t("settings.formConfig.preview.asRole")}</Label>
              <Select value={previewRoleId} onValueChange={setPreviewRoleId}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleKeysForPreview.map((rid) => (
                    <SelectItem key={rid} value={rid}>
                      {rid}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="border rounded-lg p-4 max-h-125 overflow-y-auto bg-muted/20">
            <FormConfigLivePreview
              organizationId={organizationId ?? 0}
              formEntry={formEntry}
              roleId={
                roleKeysForPreview.includes(previewRoleId)
                  ? previewRoleId
                  : roleKeysForPreview[0]
              }
            />
          </div>
        </TabsContent>

        <TabsContent value="import" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("settings.formConfig.export.title")}</CardTitle>
                <CardDescription>{t("settings.formConfig.export.description")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full gap-2" type="button" disabled>
                  <Download className="h-4 w-4" />
                  {t("settings.formConfig.export.button")}
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("settings.formConfig.import.title")}</CardTitle>
                <CardDescription>{t("settings.formConfig.import.description")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full gap-2" type="button" disabled>
                  <Upload className="h-4 w-4" />
                  {t("settings.formConfig.import.button")}
                </Button>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("settings.formConfig.resetDefaults.title")}</CardTitle>
              <CardDescription>{t("settings.formConfig.resetDefaults.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="destructive" className="gap-2" type="button" disabled>
                <RotateCcw className="h-4 w-4" />
                {t("settings.formConfig.resetDefaults.button")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={isFieldDialogOpen} onOpenChange={setIsFieldDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("settings.formConfig.fieldDialog.title")}</DialogTitle>
            <DialogDescription>{t("settings.formConfig.fieldDialog.descriptionCustom")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("settings.formConfig.fieldDialog.fieldKey")}</Label>
                <Input
                  placeholder={t("settings.formConfig.fieldDialog.fieldKeyPlaceholder")}
                  value={fieldKey}
                  onChange={e => setFieldKey(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("settings.formConfig.fieldDialog.label")}</Label>
                <Input
                  placeholder={t("settings.formConfig.fieldDialog.labelPlaceholder")}
                  value={fieldLabel}
                  onChange={e => setFieldLabel(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("settings.formConfig.fieldDialog.type")}</Label>
              <Select value={fieldType} onValueChange={v => setFieldType(v as FieldType)}>
                <SelectTrigger>
                  <SelectValue placeholder={t("settings.formConfig.fieldDialog.typePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES_FOR_CUSTOM.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`settings.formConfig.fieldDialog.fieldTypes.${type}`, { defaultValue: type })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center space-x-2">
                <Switch id="required" checked={fieldRequired} onCheckedChange={setFieldRequired} />
                <Label htmlFor="required">{t("settings.formConfig.fieldDialog.required")}</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFieldDialogOpen(false)} type="button">
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void handleAddCustomField()} disabled={isSaving} type="button">
              {t("settings.formConfig.fieldDialog.saveField")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Live preview (persisted + role-filtered fields) ──────────────────────────
function FormConfigLivePreview({
  organizationId,
  formEntry,
  roleId,
}: {
  organizationId: number
  formEntry: FormRegistryEntry
  roleId: string | undefined
}) {
  const { t } = useTranslation()
  const { config, isLoading, error } = useFormConfiguration({
    moduleId: formEntry.moduleId,
    formId: formEntry.formId,
    organizationId,
    roleId,
    useDefaultIfMissing: true,
    forAdminSettings: false,
  })

  if (!organizationId) {
    return <p className="text-sm text-muted-foreground">{t("settings.formConfig.noOrganization")}</p>
  }
  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  return (
    <ConfigurableForm
      config={config}
      isLoading={isLoading}
      onSubmit={async () => {}}
      showActions={false}
      disabled
      submitLabel={t("settings.formConfig.preview.submitHidden")}
    />
  )
}

// ── Field Config Card ───────────────────────────────────────────────────────
// Defined outside UnifiedFormConfigSettings to avoid re-creating on each render
interface FieldConfigCardProps {
  field: ParsedFormField
  index: number
  canMutate: boolean
  onEdit: () => void
  onToggleEnabled: (field: ParsedFormField, next: boolean) => void
  onDelete: (field: ParsedFormField) => void
}

function FieldConfigCard({
  field,
  onEdit,
  onToggleEnabled,
  onDelete,
  canMutate,
}: FieldConfigCardProps) {
  const { t } = useTranslation()

  const handleToggle = () => {
    onToggleEnabled(field, !field.isEnabled)
  }

  return (
    <Card className={cn("transition-all", !field.isEnabled && "opacity-50")}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-1 cursor-move">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{field.label}</span>
              {field.isSystem && (
                <Badge variant="secondary" className="text-xs">
                  {t("settings.formConfig.fieldCard.system")}
                </Badge>
              )}
              {field.validation?.required && (
                <Badge variant="outline" className="text-xs">
                  {t("settings.formConfig.fieldCard.required")}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
              <span className="capitalize">{field.type}</span>
              <span>·</span>
              <span className="capitalize">{field.width}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={handleToggle} disabled={!canMutate}>
              {field.isEnabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="h-4 w-4 mr-2" />
                  {t("settings.formConfig.fieldCard.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Copy className="h-4 w-4 mr-2" />
                  {t("settings.formConfig.fieldCard.duplicate")}
                </DropdownMenuItem>
                {!field.isSystem && (
                  <DropdownMenuItem
                    className="text-destructive"
                    disabled={!canMutate}
                    onClick={() => onDelete(field)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t("settings.formConfig.fieldCard.delete")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
