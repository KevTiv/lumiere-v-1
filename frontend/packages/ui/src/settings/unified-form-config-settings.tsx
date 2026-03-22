"use client"

import { useState, useMemo } from "react"
import { useTranslation } from "@lumiere/i18n"
import { cn } from "@/lib/utils"
import { useRBAC } from "@/lib/rbac-context"
import { formRegistry } from "../forms/config/registry"
import type { FormRegistryEntry, FormModuleMetadata } from "../forms/config/types"
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
  const { isAdmin } = useRBAC()
  const [isViewingSettings, setIsViewingSettings] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedModule, setSelectedModule] = useState<string | null>(null)
  const [selectedForm, setSelectedForm] = useState<FormRegistryEntry | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const [isFieldDialogOpen, setIsFieldDialogOpen] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

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

  const formConfig = useMemo(() => {
    if (!selectedForm) return null
    return selectedForm.defaultConfig()
  }, [selectedForm])

  const handleModuleSelect = (moduleId: string) => {
    setSelectedModule(moduleId)
    setSelectedForm(null)
    setHasChanges(false)
  }

  const handleFormSelect = (form: FormRegistryEntry) => {
    setSelectedForm(form)
    setHasChanges(false)
  }

  const handleBackToModules = () => {
    setSelectedModule(null)
    setSelectedForm(null)
    setIsViewingSettings(false)
    setHasChanges(false)
  }

  const handleBackToForms = () => {
    setSelectedForm(null)
    setHasChanges(false)
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
    <div className={cn("space-y-6", className)}>
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={handleBackToForms} className="gap-2">
          <ChevronRight className="h-4 w-4 rotate-180" />
          {t("settings.formConfig.backToForms")}
        </Button>
        <div className="flex-1">
          <h3 className="text-lg font-semibold">{selectedForm.name}</h3>
          <p className="text-sm text-muted-foreground">{selectedForm.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setHasChanges(false)}>
            <RotateCcw className="h-4 w-4" />
            {t("settings.formConfig.reset")}
          </Button>
          <Button size="sm" className="gap-2" disabled={!hasChanges}>
            <Save className="h-4 w-4" />
            {t("settings.formConfig.saveChanges")}
          </Button>
        </div>
      </div>

      {hasChanges && (
        <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
          <AlertCircle className="h-4 w-4 text-yellow-600" />
          <span className="text-sm text-yellow-800">{t("settings.formConfig.unsavedChanges")}</span>
        </div>
      )}

      <Tabs defaultValue="fields" className="w-full flex flex-col">
        <TabsList className="grid w-full grid-cols-3 lg:w-100">
          <TabsTrigger value="fields">{t("settings.formConfig.tabs.fields")}</TabsTrigger>
          <TabsTrigger value="roles">{t("settings.formConfig.tabs.roles")}</TabsTrigger>
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
            <Button onClick={() => setIsFieldDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              {t("settings.formConfig.addField")}
            </Button>
          </div>

          {formConfig && (
            <ScrollArea className="h-[500px] border rounded-lg p-4">
              <div className={viewMode === "grid" ? "grid gap-4 md:grid-cols-2" : "space-y-3"}>
                {formConfig.fields.map((field: any, index: number) => (
                  <FieldConfigCard
                    key={field.fieldId}
                    field={field}
                    index={index}
                    onEdit={() => setIsFieldDialogOpen(true)}
                    onToggleEnabled={() => setHasChanges(true)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="roles" className="space-y-4">
          {formConfig?.roleConfigs && (
            <div className="space-y-4">
              {Object.entries(formConfig.roleConfigs).map(([roleId, config]: [string, any]) => (
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

        <TabsContent value="import" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("settings.formConfig.export.title")}</CardTitle>
                <CardDescription>{t("settings.formConfig.export.description")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full gap-2">
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
                <Button variant="outline" className="w-full gap-2">
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
              <Button variant="destructive" className="gap-2">
                <RotateCcw className="h-4 w-4" />
                {t("settings.formConfig.resetDefaults.button")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Field Dialog */}
      <Dialog open={isFieldDialogOpen} onOpenChange={setIsFieldDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("settings.formConfig.fieldDialog.title")}</DialogTitle>
            <DialogDescription>{t("settings.formConfig.fieldDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("settings.formConfig.fieldDialog.fieldId")}</Label>
                <Input placeholder={t("settings.formConfig.fieldDialog.fieldIdPlaceholder")} />
              </div>
              <div className="space-y-2">
                <Label>{t("settings.formConfig.fieldDialog.fieldName")}</Label>
                <Input placeholder={t("settings.formConfig.fieldDialog.fieldNamePlaceholder")} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("settings.formConfig.fieldDialog.label")}</Label>
              <Input placeholder={t("settings.formConfig.fieldDialog.labelPlaceholder")} />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.formConfig.fieldDialog.type")}</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder={t("settings.formConfig.fieldDialog.typePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {(["Text", "Textarea", "Number", "Select", "Date", "Checkbox", "Radio", "Rating", "Tags"] as const).map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`settings.formConfig.fieldDialog.fieldTypes.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center space-x-2">
                <Switch id="required" />
                <Label htmlFor="required">{t("settings.formConfig.fieldDialog.required")}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="enabled" defaultChecked />
                <Label htmlFor="enabled">{t("settings.formConfig.fieldDialog.enabled")}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="system" />
                <Label htmlFor="system">{t("settings.formConfig.fieldDialog.systemField")}</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFieldDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => { setIsFieldDialogOpen(false); setHasChanges(true) }}>
              {t("settings.formConfig.fieldDialog.saveField")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Field Config Card ───────────────────────────────────────────────────────
// Defined outside UnifiedFormConfigSettings to avoid re-creating on each render
interface FieldConfigCardProps {
  field: any
  index: number
  onEdit: () => void
  onToggleEnabled: () => void
}

function FieldConfigCard({ field, index, onEdit, onToggleEnabled }: FieldConfigCardProps) {
  const { t } = useTranslation()
  const [isEnabled, setIsEnabled] = useState(field.isEnabled)

  const handleToggle = () => {
    setIsEnabled(!isEnabled)
    onToggleEnabled()
  }

  return (
    <Card className={cn("transition-all", !isEnabled && "opacity-50")}>
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
              <span className="capitalize">{field.fieldType}</span>
              <span>·</span>
              <span className="capitalize">{field.width}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={handleToggle}>
              {isEnabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
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
                  <DropdownMenuItem className="text-destructive">
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
