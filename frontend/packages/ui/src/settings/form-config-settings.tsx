"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { useRBAC } from "@/lib/rbac-context"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
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
  BookMarked,
  FileSearch,
  Plus,
  GripVertical,
  Pencil,
  Trash2,
  Copy,
  Eye,
  EyeOff,
  MoreVertical,
  Save,
  Sparkles,
  Users,
  Settings2,
  ChevronRight,
  AlertCircle,
  Check,
} from "lucide-react"
import type {
  FormConfiguration,
  ConfigurableField,
  FieldType,
  FieldOption
} from "@/lib/form-config-types"
import {
  defaultJournalFormConfig,
  defaultForensicFormConfig
} from "@/lib/form-config-types"
import { defaultRoles } from "@/lib/rbac-defaults"

const fieldTypeOptions: { value: FieldType; label: string; description: string }[] = [
  { value: "text", label: "Text", description: "Single line text input" },
  { value: "textarea", label: "Text Area", description: "Multi-line text input" },
  { value: "number", label: "Number", description: "Numeric input" },
  { value: "select", label: "Dropdown", description: "Single selection from options" },
  { value: "multiselect", label: "Multi-Select", description: "Multiple selections from options" },
  { value: "date", label: "Date", description: "Date picker" },
  { value: "time", label: "Time", description: "Time picker" },
  { value: "datetime", label: "Date & Time", description: "Date and time picker" },
  { value: "checkbox", label: "Checkbox", description: "Yes/No toggle" },
  { value: "radio", label: "Radio Buttons", description: "Single choice from visible options" },
  { value: "rating", label: "Rating", description: "Star rating (1-5)" },
  { value: "slider", label: "Slider", description: "Numeric slider" },
  { value: "tags", label: "Tags", description: "Multiple tag input" },
  { value: "user-select", label: "User Select", description: "Select team member" },
  { value: "file", label: "File Upload", description: "File attachment" },
]

interface FormConfigSettingsProps {
  className?: string
}

export function FormConfigSettings({ className }: FormConfigSettingsProps) {
  const { isAdmin } = useRBAC()
  const [activeTab, setActiveTab] = useState<"journal" | "forensic">("journal")
  const [journalConfig, setJournalConfig] = useState<FormConfiguration>(defaultJournalFormConfig)
  const [forensicConfig, setForensicConfig] = useState<FormConfiguration>(defaultForensicFormConfig)
  const [selectedField, setSelectedField] = useState<ConfigurableField | null>(null)
  const [isFieldDialogOpen, setIsFieldDialogOpen] = useState(false)
  const [isNewField, setIsNewField] = useState(false)
  const [editingRoleConfig, setEditingRoleConfig] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  const activeConfig = activeTab === "journal" ? journalConfig : forensicConfig
  const setActiveConfig = activeTab === "journal" ? setJournalConfig : setForensicConfig

  const handleFieldToggle = (fieldId: string, enabled: boolean) => {
    setActiveConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f =>
        f.id === fieldId ? { ...f, isEnabled: enabled } : f
      ),
      updatedAt: new Date().toISOString(),
    }))
    setHasChanges(true)
  }

  const handleEditField = (field: ConfigurableField) => {
    setSelectedField({ ...field })
    setIsNewField(false)
    setIsFieldDialogOpen(true)
  }

  const handleAddField = () => {
    const newField: ConfigurableField = {
      id: `field-${Date.now()}`,
      name: "",
      label: "",
      type: "text",
      isSystem: false,
      isEnabled: true,
      order: activeConfig.fields.length + 1,
    }
    setSelectedField(newField)
    setIsNewField(true)
    setIsFieldDialogOpen(true)
  }

  const handleSaveField = () => {
    if (!selectedField) return

    if (isNewField) {
      setActiveConfig(prev => ({
        ...prev,
        fields: [...prev.fields, selectedField],
        updatedAt: new Date().toISOString(),
      }))
    } else {
      setActiveConfig(prev => ({
        ...prev,
        fields: prev.fields.map(f =>
          f.id === selectedField.id ? selectedField : f
        ),
        updatedAt: new Date().toISOString(),
      }))
    }
    setIsFieldDialogOpen(false)
    setSelectedField(null)
    setHasChanges(true)
  }

  const handleDeleteField = (fieldId: string) => {
    setActiveConfig(prev => ({
      ...prev,
      fields: prev.fields.filter(f => f.id !== fieldId),
      updatedAt: new Date().toISOString(),
    }))
    setHasChanges(true)
  }

  const handleDuplicateField = (field: ConfigurableField) => {
    const newField: ConfigurableField = {
      ...field,
      id: `field-${Date.now()}`,
      name: `${field.name}_copy`,
      label: `${field.label} (Copy)`,
      isSystem: false,
      order: activeConfig.fields.length + 1,
    }
    setActiveConfig(prev => ({
      ...prev,
      fields: [...prev.fields, newField],
      updatedAt: new Date().toISOString(),
    }))
    setHasChanges(true)
  }

  const handleRoleFieldToggle = (roleId: string, fieldId: string, enabled: boolean) => {
    setActiveConfig(prev => {
      const roleConfig = prev.roleConfigs?.[roleId] || { enabledFields: [], requiredFields: [] }
      const enabledFields = enabled
        ? [...roleConfig.enabledFields, fieldId]
        : roleConfig.enabledFields.filter(f => f !== fieldId)

      return {
        ...prev,
        roleConfigs: {
          ...prev.roleConfigs,
          [roleId]: { ...roleConfig, enabledFields },
        },
        updatedAt: new Date().toISOString(),
      }
    })
    setHasChanges(true)
  }

  const handleRoleFieldRequired = (roleId: string, fieldId: string, required: boolean) => {
    setActiveConfig(prev => {
      const roleConfig = prev.roleConfigs?.[roleId] || { enabledFields: [], requiredFields: [] }
      const requiredFields = required
        ? [...roleConfig.requiredFields, fieldId]
        : roleConfig.requiredFields.filter(f => f !== fieldId)

      return {
        ...prev,
        roleConfigs: {
          ...prev.roleConfigs,
          [roleId]: { ...roleConfig, requiredFields },
        },
        updatedAt: new Date().toISOString(),
      }
    })
    setHasChanges(true)
  }

  const handleSaveChanges = () => {
    // In a real app, this would save to database
    console.log("Saving configuration:", activeConfig)
    setHasChanges(false)
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Form Configuration</h3>
          <p className="text-sm text-muted-foreground">
            Configure input fields for Journal and Forensic Reports
          </p>
        </div>
        {hasChanges && (
          <Button onClick={handleSaveChanges} className="gap-2">
            <Save className="h-4 w-4" />
            Save Changes
          </Button>
        )}
      </div>

      {/* Tabs for Journal / Forensic */}
      <Tabs value={activeTab} className="flex flex-col" onValueChange={(v) => setActiveTab(v as "journal" | "forensic")}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="journal" className="gap-2">
            <BookMarked className="h-4 w-4" />
            Journal Fields
          </TabsTrigger>
          <TabsTrigger value="forensic" className="gap-2">
            <FileSearch className="h-4 w-4" />
            Forensic Fields
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6 space-y-6">
          {/* Form Info Card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">{activeConfig.name}</CardTitle>
                  <CardDescription>{activeConfig.description}</CardDescription>
                </div>
                <Badge variant="outline" className="gap-1">
                  {activeConfig.fields.filter(f => f.isEnabled).length} active fields
                </Badge>
              </div>
            </CardHeader>
          </Card>

          {/* Fields List */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Form Fields</CardTitle>
                <Button size="sm" onClick={handleAddField} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add Field
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-2">
                  {activeConfig.fields
                    .sort((a, b) => a.order - b.order)
                    .map((field) => (
                      <div
                        key={field.id}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                          field.isEnabled
                            ? "bg-card border-border"
                            : "bg-muted/50 border-transparent opacity-60"
                        )}
                      >
                        <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{field.label}</span>
                            {field.isSystem && (
                              <Badge variant="secondary" className="text-xs">System</Badge>
                            )}
                            {field.validation?.required && (
                              <Badge variant="outline" className="text-xs text-orange-600 border-orange-200">Required</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            <span className="capitalize">{field.type.replace("-", " ")}</span>
                            {field.description && (
                              <>
                                <span>·</span>
                                <span className="truncate">{field.description}</span>
                              </>
                            )}
                          </div>
                        </div>

                        <Switch
                          checked={field.isEnabled}
                          onCheckedChange={(checked) => handleFieldToggle(field.id, checked)}
                          disabled={field.isSystem && field.validation?.required}
                        />

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEditField(field)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDuplicateField(field)}>
                              <Copy className="h-4 w-4 mr-2" />
                              Duplicate
                            </DropdownMenuItem>
                            {!field.isSystem && (
                              <DropdownMenuItem
                                onClick={() => handleDeleteField(field.id)}
                                className="text-red-600"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Role-based Configuration */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base">Role-based Field Visibility</CardTitle>
                  <CardDescription>Configure which fields each role can see and which are required</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {defaultRoles.map((role) => {
                  const roleConfig = activeConfig.roleConfigs?.[role.id]
                  const enabledCount = roleConfig?.enabledFields?.length || 0
                  const requiredCount = roleConfig?.requiredFields?.length || 0

                  return (
                    <div
                      key={role.id}
                      className="flex items-center justify-between p-3 rounded-lg border hover:border-primary/50 transition-colors cursor-pointer"
                      onClick={() => setEditingRoleConfig(editingRoleConfig === role.id ? null : role.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: `var(--${role.color || 'gray'}-500, #6b7280)` }}
                        />
                        <div>
                          <p className="font-medium text-sm">{role.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {enabledCount} fields enabled · {requiredCount} required
                          </p>
                        </div>
                      </div>
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 text-muted-foreground transition-transform",
                          editingRoleConfig === role.id && "rotate-90"
                        )}
                      />
                    </div>
                  )
                })}
              </div>

              {/* Expanded Role Config */}
              {editingRoleConfig && (
                <div className="mt-4 p-4 rounded-lg border bg-muted/30">
                  <h4 className="font-medium mb-3">
                    Configure fields for {defaultRoles.find(r => r.id === editingRoleConfig)?.name}
                  </h4>
                  <div className="grid gap-2 max-h-[300px] overflow-y-auto">
                    {activeConfig.fields.filter(f => f.isEnabled).map((field) => {
                      const roleConfig = activeConfig.roleConfigs?.[editingRoleConfig]
                      const isEnabled = roleConfig?.enabledFields?.includes(field.id) ?? true
                      const isRequired = roleConfig?.requiredFields?.includes(field.id) ?? false

                      return (
                        <div
                          key={field.id}
                          className="flex items-center justify-between py-2 px-3 rounded bg-background"
                        >
                          <span className="text-sm">{field.label}</span>
                          <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 text-xs">
                              <Switch
                                checked={isEnabled}
                                onCheckedChange={(checked) =>
                                  handleRoleFieldToggle(editingRoleConfig, field.id, checked)
                                }
                                className="scale-75"
                              />
                              <span className="text-muted-foreground">Visible</span>
                            </label>
                            <label className="flex items-center gap-2 text-xs">
                              <Switch
                                checked={isRequired}
                                onCheckedChange={(checked) =>
                                  handleRoleFieldRequired(editingRoleConfig, field.id, checked)
                                }
                                disabled={!isEnabled}
                                className="scale-75"
                              />
                              <span className="text-muted-foreground">Required</span>
                            </label>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* AI Suggestions Configuration */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle className="text-base">AI Suggestions</CardTitle>
                  <CardDescription>Configure AI-powered suggestions for each field</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {activeConfig.fields
                  .filter(f => f.isEnabled && (f.type === "textarea" || f.type === "text"))
                  .map((field) => (
                    <div key={field.id} className="p-3 rounded-lg border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">{field.label}</span>
                        <Badge variant="outline" className="text-xs">
                          {field.aiSuggestions?.length || 0} suggestions
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {field.aiSuggestions?.map((suggestion, idx) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            {suggestion}
                          </Badge>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 px-2 text-xs"
                          onClick={() => handleEditField(field)}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Field Edit Dialog */}
      <Dialog open={isFieldDialogOpen} onOpenChange={setIsFieldDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNewField ? "Add New Field" : "Edit Field"}</DialogTitle>
            <DialogDescription>
              Configure the field properties and validation rules
            </DialogDescription>
          </DialogHeader>

          {selectedField && (
            <div className="space-y-6 py-4">
              {/* Basic Info */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="field-label">Label</Label>
                  <Input
                    id="field-label"
                    value={selectedField.label}
                    onChange={(e) => setSelectedField({
                      ...selectedField,
                      label: e.target.value,
                      name: e.target.value.toLowerCase().replace(/\s+/g, "_"),
                    })}
                    placeholder="Field label"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="field-type">Type</Label>
                  <Select
                    value={selectedField.type}
                    onValueChange={(value) => setSelectedField({
                      ...selectedField,
                      type: value as FieldType
                    })}
                  >
                    <SelectTrigger id="field-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {fieldTypeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          <div>
                            <div>{option.label}</div>
                            <div className="text-xs text-muted-foreground">{option.description}</div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="field-description">Description</Label>
                <Input
                  id="field-description"
                  value={selectedField.description || ""}
                  onChange={(e) => setSelectedField({
                    ...selectedField,
                    description: e.target.value
                  })}
                  placeholder="Help text shown to users"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="field-placeholder">Placeholder</Label>
                <Input
                  id="field-placeholder"
                  value={selectedField.placeholder || ""}
                  onChange={(e) => setSelectedField({
                    ...selectedField,
                    placeholder: e.target.value
                  })}
                  placeholder="Placeholder text"
                />
              </div>

              {/* Options for select/radio/multiselect */}
              {["select", "multiselect", "radio"].includes(selectedField.type) && (
                <div className="space-y-2">
                  <Label>Options</Label>
                  <div className="space-y-2">
                    {(selectedField.options || []).map((option, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Input
                          value={option.label}
                          onChange={(e) => {
                            const newOptions = [...(selectedField.options || [])]
                            newOptions[idx] = {
                              ...option,
                              label: e.target.value,
                              value: e.target.value.toLowerCase().replace(/\s+/g, "-"),
                            }
                            setSelectedField({ ...selectedField, options: newOptions })
                          }}
                          placeholder="Option label"
                          className="flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            const newOptions = selectedField.options?.filter((_, i) => i !== idx)
                            setSelectedField({ ...selectedField, options: newOptions })
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const newOptions = [
                          ...(selectedField.options || []),
                          { value: "", label: "" },
                        ]
                        setSelectedField({ ...selectedField, options: newOptions })
                      }}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Option
                    </Button>
                  </div>
                </div>
              )}

              {/* AI Suggestions */}
              {["text", "textarea"].includes(selectedField.type) && (
                <div className="space-y-2">
                  <Label>AI Suggestions</Label>
                  <Textarea
                    value={selectedField.aiSuggestions?.join("\n") || ""}
                    onChange={(e) => setSelectedField({
                      ...selectedField,
                      aiSuggestions: e.target.value.split("\n").filter(Boolean)
                    })}
                    placeholder="Enter one suggestion per line"
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">
                    These suggestions will appear as clickable chips when users focus on the field
                  </p>
                </div>
              )}

              {/* Validation */}
              <div className="space-y-4">
                <Label className="text-base">Validation</Label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="field-required" className="font-normal">Required</Label>
                    <Switch
                      id="field-required"
                      checked={selectedField.validation?.required || false}
                      onCheckedChange={(checked) => setSelectedField({
                        ...selectedField,
                        validation: { ...selectedField.validation, required: checked },
                      })}
                    />
                  </div>

                  {["text", "textarea"].includes(selectedField.type) && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="min-length">Min Length</Label>
                        <Input
                          id="min-length"
                          type="number"
                          value={selectedField.validation?.minLength || ""}
                          onChange={(e) => setSelectedField({
                            ...selectedField,
                            validation: {
                              ...selectedField.validation,
                              minLength: parseInt(e.target.value) || undefined
                            },
                          })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="max-length">Max Length</Label>
                        <Input
                          id="max-length"
                          type="number"
                          value={selectedField.validation?.maxLength || ""}
                          onChange={(e) => setSelectedField({
                            ...selectedField,
                            validation: {
                              ...selectedField.validation,
                              maxLength: parseInt(e.target.value) || undefined
                            },
                          })}
                        />
                      </div>
                    </>
                  )}

                  {["number", "slider", "rating"].includes(selectedField.type) && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="min-value">Min Value</Label>
                        <Input
                          id="min-value"
                          type="number"
                          value={selectedField.validation?.min || ""}
                          onChange={(e) => setSelectedField({
                            ...selectedField,
                            validation: {
                              ...selectedField.validation,
                              min: parseInt(e.target.value) || undefined
                            },
                          })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="max-value">Max Value</Label>
                        <Input
                          id="max-value"
                          type="number"
                          value={selectedField.validation?.max || ""}
                          onChange={(e) => setSelectedField({
                            ...selectedField,
                            validation: {
                              ...selectedField.validation,
                              max: parseInt(e.target.value) || undefined
                            },
                          })}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFieldDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveField}>
              {isNewField ? "Add Field" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
