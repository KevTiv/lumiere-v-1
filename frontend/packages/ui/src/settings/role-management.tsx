"use client"

import { useState } from "react"
import { useRBAC } from "@/lib/rbac-context"
import { resourceGroups } from "@/lib/rbac-defaults"
import {
  permissionsMapToStrings,
  useAddCasbinRule,
  useCreateRole,
  useRemoveCasbinRule,
  useSettingsRoles,
  useUpdateRole,
} from "@lumiere/query-hooks/hooks/auth"
import { useErpSession } from "@lumiere/erp-session"
import { hasValidOrganizationId } from "@/lib/org-scoped"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { 
  Plus, 
  Pencil, 
  Trash2, 
  Shield,
  Lock,
  Check,
  X
} from "lucide-react"
import type { Role, Resource, Action } from "@/lib/rbac-types"
import { cn } from "@/lib/utils"
import { useTranslation } from "@lumiere/i18n"
import { rolePillClassForColor, roleSwatchClass } from "@/lib/theme-colors"
import { FormModal } from "../forms/form-modal"
import { addCasbinRuleForm, removeCasbinRuleForm } from "../lib/settings-platform-form-configs"

const roleColors = [
  { value: "blue", label: "Blue", class: roleSwatchClass.blue },
  { value: "green", label: "Green", class: roleSwatchClass.green },
  { value: "orange", label: "Orange", class: roleSwatchClass.orange },
  { value: "red", label: "Red", class: roleSwatchClass.red },
  { value: "purple", label: "Purple", class: roleSwatchClass.purple },
  { value: "teal", label: "Teal", class: roleSwatchClass.teal },
] as const

export function RoleManagement() {
  const { t } = useTranslation()
  const { organizationId } = useErpSession()
  const orgReady = hasValidOrganizationId(organizationId)
  const orgBigInt = orgReady ? BigInt(organizationId) : 0n
  const { data: rolesData = [], isLoading, refetch } = useSettingsRoles(orgBigInt)
  const roles = rolesData as Role[]
  const createRole = useCreateRole(orgBigInt)
  const updateRole = useUpdateRole(orgBigInt)
  const addCasbinRule = useAddCasbinRule(orgBigInt)
  const removeCasbinRule = useRemoveCasbinRule(orgBigInt)
  const { checkPermission } = useRBAC()
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [casbinModal, setCasbinModal] = useState<"add" | "remove" | null>(null)
  const [casbinError, setCasbinError] = useState<string | null>(null)
  const [selectedPermissions, setSelectedPermissions] = useState<Map<string, Set<Action>>>(new Map())
  const [selectedColor, setSelectedColor] = useState<Role["color"]>("blue")
  const [isSaving, setIsSaving] = useState(false)

  const canEdit = checkPermission("admin:roles", "update").allowed
  const canDelete = checkPermission("admin:roles", "delete").allowed
  const canCreate = checkPermission("admin:roles", "create").allowed
  const canManagePolicies = checkPermission("admin:permissions", "manage").allowed

  const initializePermissions = (role: Role | null) => {
    const permMap = new Map<string, Set<Action>>()
    const knownResources = new Set(resourceGroups.flatMap((group) => group.resources.map((res) => res.resource)))
    
    if (role) {
      // Check for wildcard permission
      const hasWildcard = role.permissions.some(p => p.resource === "*" && p.action === "*")
      
      if (hasWildcard) {
        // Set all permissions
        resourceGroups.forEach(group => {
          group.resources.forEach(res => {
            permMap.set(res.resource, new Set(res.actions))
          })
        })
      } else {
        role.permissions.forEach(perm => {
          if (perm.effect === "allow") {
            if (perm.resource === "*" || !knownResources.has(perm.resource)) return
            const existing = permMap.get(perm.resource as string) || new Set()
            if (perm.action === "*") {
              const resourceDef = resourceGroups
                .flatMap(g => g.resources)
                .find(r => r.resource === perm.resource)
              if (resourceDef) {
                resourceDef.actions.forEach(a => existing.add(a))
              }
            } else {
              existing.add(perm.action)
            }
            permMap.set(perm.resource as string, existing)
          }
        })
      }
    }
    
    setSelectedPermissions(permMap)
  }

  const handleEditRole = (role: Role) => {
    setEditingRole(role)
    setSelectedColor(role.color)
    initializePermissions(role)
    setIsDialogOpen(true)
  }

  const handleCreateRole = () => {
    setEditingRole(null)
    setSelectedColor("blue")
    setSelectedPermissions(new Map())
    setIsDialogOpen(true)
  }

  const handleTogglePermission = (resource: Resource, action: Action) => {
    setSelectedPermissions(prev => {
      const newMap = new Map(prev)
      const existing = newMap.get(resource) || new Set()
      
      if (existing.has(action)) {
        existing.delete(action)
        if (existing.size === 0) {
          newMap.delete(resource)
        }
      } else {
        existing.add(action)
        newMap.set(resource, existing)
      }
      
      return newMap
    })
  }

  const handleToggleAllActions = (resource: Resource, actions: Action[]) => {
    setSelectedPermissions(prev => {
      const newMap = new Map(prev)
      const existing = newMap.get(resource) || new Set()
      const allSelected = actions.every(a => existing.has(a))
      
      if (allSelected) {
        newMap.delete(resource)
      } else {
        newMap.set(resource, new Set(actions))
      }
      
      return newMap
    })
  }

  const handleSaveRole = async (formData: FormData) => {
    if (!orgReady) return

    const name = formData.get("name") as string
    const description = formData.get("description") as string
    const permissionStrings = permissionsMapToStrings(selectedPermissions)
    const metadata = JSON.stringify({
      color: selectedColor,
      uiPermissions: permissionStrings,
    })

    setIsSaving(true)
    try {
      if (editingRole) {
        await updateRole.mutateAsync({
          roleId: editingRole.id,
          params: {
            name,
            description: description || null,
            permissions: permissionStrings,
          },
        })
      } else {
        await createRole.mutateAsync({
          name,
          description: description || null,
          permissions: permissionStrings,
          isActive: true,
          parentId: null,
          metadata,
        })
      }
      await refetch()
      setIsDialogOpen(false)
    } catch (error) {
      console.error(error)
      alert(t("settings.formConfig.fieldUpdateError"))
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteRole = (roleId: string) => {
    const role = roles.find(r => r.id === roleId)
    if (role?.isSystem) {
      alert(t("settings.roles.systemCannotDelete"))
      return
    }
    if (confirm(t("settings.roles.deleteConfirm"))) {
      alert(t("settings.formConfig.fieldDeleteError"))
    }
  }

  const countPermissions = (role: Role): number => {
    if (role.permissions.some(p => p.resource === "*" && p.action === "*")) {
      return resourceGroups.reduce((acc, group) => 
        acc + group.resources.reduce((a, r) => a + r.actions.length, 0), 0
      )
    }
    const knownResources = new Set(resourceGroups.flatMap((group) => group.resources.map((res) => res.resource)))
    return role.permissions.filter(p => p.effect === "allow" && p.resource !== "*" && knownResources.has(p.resource)).length
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{t("settings.roles.title")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("settings.roles.description")}
          </p>
          <p className="text-xs text-muted-foreground mt-2 max-w-3xl leading-relaxed">
            {t("settings.roles.fieldPolicyHint")}
          </p>
        </div>
        {canCreate && (
          <Button onClick={handleCreateRole} className="gap-2" disabled={!orgReady || isSaving}>
            <Plus className="h-4 w-4" />
            {t("settings.roles.createRole")}
          </Button>
        )}
      </div>

      {!orgReady ? (
        <p className="text-sm text-muted-foreground">{t("settings.formConfig.noOrganization")}</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : (
      <div className="grid gap-4 md:grid-cols-2">
        {roles.map((role) => (
          <Card key={role.id} className="relative">
            {role.isSystem && (
              <Badge 
                variant="outline" 
                className="absolute top-3 right-3 gap-1 text-xs"
              >
                <Lock className="h-3 w-3" />
                {t("settings.roles.system")}
              </Badge>
            )}
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-lg border", rolePillClassForColor(role.color))}>
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base">{role.name}</CardTitle>
                  <CardDescription className="text-sm mt-1">
                    {role.description}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {t("settings.roles.permissionsCount", { count: countPermissions(role) })}
                </div>
                <div className="flex gap-2">
                  {canEdit && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleEditRole(role)}
                    >
                      <Pencil className="h-4 w-4 mr-1" />
                      {t("settings.roles.edit")}
                    </Button>
                  )}
                  {canDelete && !role.isSystem && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleDeleteRole(role.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      )}

      {canManagePolicies && orgReady ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.adminOps.casbin.cardTitle")}</CardTitle>
            <CardDescription>{t("settings.adminOps.casbin.cardDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setCasbinError(null)
                setCasbinModal("add")
              }}
            >
              {t("settings.adminOps.casbin.addButton")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setCasbinError(null)
                setCasbinModal("remove")
              }}
            >
              {t("settings.adminOps.casbin.removeButton")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRole ? t("settings.roles.editTitle", { name: editingRole.name }) : t("settings.roles.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("settings.roles.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void handleSaveRole(new FormData(event.currentTarget))
            }}
            className="space-y-6"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">{t("settings.roles.roleName")}</Label>
                <Input 
                  id="name" 
                  name="name"
                  defaultValue={editingRole?.name}
                  required
                  disabled={editingRole?.isSystem}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("settings.roles.color")}</Label>
                <div className="flex gap-2">
                  {roleColors.map(color => (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => setSelectedColor(color.value)}
                      className={`w-8 h-8 rounded-full ${color.class} flex items-center justify-center transition-transform ${
                        selectedColor === color.value ? "ring-2 ring-offset-2 ring-offset-background ring-primary scale-110" : ""
                      }`}
                    >
                      {selectedColor === color.value && (
                        <Check className="h-4 w-4 text-white" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">{t("settings.roles.roleDescription")}</Label>
              <Textarea 
                id="description" 
                name="description"
                defaultValue={editingRole?.description}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("settings.roles.permissions")}</Label>
              <Card>
                <CardContent className="p-0">
                  <Accordion type="multiple" className="w-full">
                    {resourceGroups.map((group) => (
                      <AccordionItem key={group.id} value={group.id}>
                        <AccordionTrigger className="px-4 hover:no-underline">
                          <span className="font-medium">{group.label}</span>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4">
                          <div className="space-y-3">
                            {group.resources.map((resource) => {
                              const currentPerms = selectedPermissions.get(resource.resource) || new Set()
                              const allSelected = resource.actions.every(a => currentPerms.has(a))
                              
                              return (
                                <div key={resource.resource} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                                  <div className="flex items-center gap-3">
                                    <Switch
                                      checked={allSelected}
                                      onCheckedChange={() => handleToggleAllActions(resource.resource, resource.actions)}
                                    />
                                    <span className="text-sm">{resource.label}</span>
                                  </div>
                                  <div className="flex gap-1">
                                    {resource.actions.map(action => (
                                      <Badge
                                        key={action}
                                        variant="outline"
                                        className={`cursor-pointer transition-colors ${
                                          currentPerms.has(action)
                                            ? "bg-primary/10 text-primary border-primary"
                                            : "opacity-50"
                                        }`}
                                        onClick={() => handleTogglePermission(resource.resource, action)}
                                      >
                                        {currentPerms.has(action) ? (
                                          <Check className="h-3 w-3 mr-1" />
                                        ) : (
                                          <X className="h-3 w-3 mr-1" />
                                        )}
                                        {action}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </CardContent>
              </Card>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSaving || !orgReady}>
                {editingRole ? t("settings.roles.saveChanges") : t("settings.roles.createRole")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {casbinModal ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setCasbinModal(null)
              setCasbinError(null)
            }
          }}
          config={casbinModal === "add" ? addCasbinRuleForm(t) : removeCasbinRuleForm(t)}
          isPending={addCasbinRule.isPending || removeCasbinRule.isPending}
          closeOnSubmit={false}
          submitError={casbinError}
          onSubmit={async (data) => {
            setCasbinError(null)
            try {
              if (casbinModal === "add") {
                await addCasbinRule.mutateAsync({
                  ...data,
                  v1: data.v1 ?? String(organizationId),
                })
              } else {
                await removeCasbinRule.mutateAsync(data.ruleId as string | number)
              }
              setCasbinModal(null)
            } catch (error) {
              setCasbinError(error instanceof Error ? error.message : String(error))
            }
          }}
        />
      ) : null}
    </div>
  )
}
