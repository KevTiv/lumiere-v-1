"use client"

import { useMemo, useState } from "react"
import { useRBAC } from "@/lib/rbac-context"
import {
  useAssignRole,
  useAddOrgMember,
  useAddUserToOrganization,
  useCreateUserInvite,
  useRemoveUserFromOrganization,
  useRevokeRole,
  useSettingsRoles,
  useSettingsUsers,
  useUpdateOrgMemberDetails,
  useUpdateOrgMemberRole,
  useUpdateUserOrganizationStatus,
  type SettingsUserRecord,
} from "@lumiere/query-hooks/hooks/auth"
import { useEmployees } from "@lumiere/query-hooks/hooks/hr"
import { useErpSession } from "@lumiere/erp-session"
import { hasValidOrganizationId } from "@/lib/org-scoped"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { 
  Search, 
  Plus, 
  MoreHorizontal, 
  Pencil, 
  Trash2, 
  UserCheck,
  UserX,
  Mail
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Role } from "@/lib/rbac-types"
import { useTranslation } from "@lumiere/i18n"
import { rolePillClassForColor, userStatusPillClass } from "@/lib/theme-colors"
import { FormModal } from "../forms/form-modal"
import {
  addOrgMemberForm,
  addUserToOrganizationForm,
  updateOrgMemberDetailsForm,
  updateOrgMemberRoleForm,
} from "../lib/settings-platform-form-configs"

function identityHexForAssign(value: string): string {
  const normalized = value.trim().replace(/^0x/i, "").toLowerCase()
  return normalized ? `0x${normalized}` : value.trim()
}

export function UserManagement() {
  const { t } = useTranslation()
  const { organizationId } = useErpSession()
  const orgReady = hasValidOrganizationId(organizationId)
  const orgBigInt = orgReady ? BigInt(organizationId) : 0n
  const [searchQuery, setSearchQuery] = useState("")
  const { data: users = [], isLoading, refetch } = useSettingsUsers(orgBigInt, searchQuery)
  const { data: roles = [] } = useSettingsRoles(orgBigInt)
  const assignRole = useAssignRole(orgBigInt)
  const revokeRole = useRevokeRole(orgBigInt)
  const createInvite = useCreateUserInvite(orgBigInt)
  const addOrgMember = useAddOrgMember(orgBigInt)
  const addUserToOrganization = useAddUserToOrganization(orgBigInt)
  const updateOrgMemberDetails = useUpdateOrgMemberDetails(orgBigInt)
  const updateOrgMemberRole = useUpdateOrgMemberRole(orgBigInt)
  const removeUser = useRemoveUserFromOrganization(orgBigInt)
  const updateOrgStatus = useUpdateUserOrganizationStatus(orgBigInt)
  const { checkPermission } = useRBAC()
  const [editingUser, setEditingUser] = useState<SettingsUserRecord | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [memberModal, setMemberModal] = useState<"addByName" | "addById" | "updateDetails" | "updateRole" | null>(null)
  const [memberError, setMemberError] = useState<string | null>(null)
  const { data: employees = [] } = useEmployees(orgBigInt)

  const memberSelectOptions = useMemo(
    () =>
      users
        .filter((user) => user.userOrgId != null)
        .map((user) => ({
          value: String(user.userOrgId),
          label: String(user.name ?? user.email ?? user.userOrgId),
        })),
    [users],
  )

  const employeeSelectOptions = useMemo(
    () =>
      (employees as Record<string, unknown>[]).map((row) => ({
        value: String(row.id ?? ""),
        label: String(row.name ?? row.id ?? ""),
      })),
    [employees],
  )

  const canEdit = checkPermission("admin:users", "update").allowed
  const canDelete = checkPermission("admin:users", "delete").allowed
  const canCreate = checkPermission("admin:users", "create").allowed

  const roleOptions = roles.map((role) => ({ value: role.id, label: role.name }))
  const roleNameOptions = roles.map((role) => ({ value: role.name, label: role.name }))

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.department?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleEditUser = (user: SettingsUserRecord) => {
    setEditingUser(user)
    setSelectedRoles(user.roles)
    setIsDialogOpen(true)
  }

  const handleCreateUser = () => {
    setEditingUser(null)
    setSelectedRoles([])
    setIsDialogOpen(true)
  }

  const syncUserRoles = async (user: SettingsUserRecord, nextRoleIds: string[]) => {
    const previousRoleIds = new Set(user.roles)
    const nextRoleSet = new Set(nextRoleIds)
    const assignmentsByRole = new Map(
      user.roleAssignments.map((entry) => [entry.roleId, entry.assignmentId]),
    )

    for (const roleId of nextRoleIds) {
      if (previousRoleIds.has(roleId)) continue
      await assignRole.mutateAsync({
        userIdentity: identityHexForAssign(user.id),
        roleId,
        params: { expiresAtMicros: null, metadata: null },
      })
    }

    for (const roleId of user.roles) {
      if (nextRoleSet.has(roleId)) continue
      const assignmentId = assignmentsByRole.get(roleId)
      if (!assignmentId) continue
      await revokeRole.mutateAsync({ assignmentId })
    }
  }

  const handleSaveUser = async (formData: FormData) => {
    if (!orgReady) return

    const email = String(formData.get("email") ?? "").trim()

    setIsSaving(true)
    try {
      if (editingUser) {
        await syncUserRoles(editingUser, selectedRoles)
        const department = String(formData.get("department") ?? "").trim()
        if (editingUser.userOrgId && department !== (editingUser.department ?? "")) {
          await updateOrgMemberDetails.mutateAsync({
            userOrgId: editingUser.userOrgId,
            params: { jobTitle: department || null, departmentId: null, employeeId: null },
          })
        }
      } else {
        if (!email) throw new Error("Email is required")
        if (selectedRoles.length === 0) throw new Error("At least one role is required")
        await createInvite.mutateAsync({
          email,
          roleId: selectedRoles[0],
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

  const handleDeleteUser = async (user: SettingsUserRecord) => {
    if (!confirm(t("settings.users.deleteConfirm"))) return
    try {
      await removeUser.mutateAsync(identityHexForAssign(user.id))
      await refetch()
    } catch (error) {
      console.error(error)
      alert(t("settings.formConfig.fieldDeleteError"))
    }
  }

  const handleToggleStatus = async (user: SettingsUserRecord) => {
    if (!user.userOrgId) {
      console.warn("Missing organization membership id; cannot update user status.")
      return
    }
    const nextActive = user.status !== "active"
    try {
      await updateOrgStatus.mutateAsync({
        userOrgId: user.userOrgId,
        isActive: nextActive,
      })
      await refetch()
    } catch (error) {
      console.error(error)
      alert(t("settings.formConfig.fieldUpdateError"))
    }
  }

  const getRoleName = (roleId: string): string => {
    return roles.find(r => r.id === roleId)?.name || roleId
  }

  const getRoleColor = (roleId: string): string => {
    const role = roles.find(r => r.id === roleId)
    return rolePillClassForColor(role?.color as Role["color"] | undefined)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("settings.users.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {canCreate && (
          <Button onClick={handleCreateUser} className="gap-2" disabled={!orgReady || isSaving}>
            <Plus className="h-4 w-4" />
            {t("settings.users.addUser")}
          </Button>
        )}
      </div>

      {canCreate && orgReady ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setMemberError(null)
              setMemberModal("addByName")
            }}
          >
            {t("settings.adminOps.members.addExistingButton")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setMemberError(null)
              setMemberModal("addById")
            }}
          >
            {t("settings.adminOps.members.addByRoleIdButton")}
          </Button>
          {canEdit ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setMemberError(null)
                  setMemberModal("updateDetails")
                }}
              >
                {t("settings.adminOps.members.updateDetailsButton")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setMemberError(null)
                  setMemberModal("updateRole")
                }}
              >
                {t("settings.adminOps.members.updateRoleButton")}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {!orgReady ? (
        <p className="text-sm text-muted-foreground">{t("settings.formConfig.noOrganization")}</p>
      ) : (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isLoading
              ? t("common.loading")
              : t("settings.users.usersCount", { count: filteredUsers.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {filteredUsers.map((user) => (
              <div 
                key={user.id}
                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
                    {user.name.split(" ").map(n => n[0]).join("")}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{user.name}</span>
                      <Badge variant="outline" className={userStatusPillClass[user.status]}>
                        {user.status}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                      <Mail className="h-3 w-3" />
                      {user.email}
                      {user.department && (
                        <>
                          <span className="text-border">•</span>
                          {user.department}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex gap-1">
                    {user.roles.map(roleId => (
                      <Badge 
                        key={roleId} 
                        variant="outline"
                        className={getRoleColor(roleId)}
                      >
                        {getRoleName(roleId)}
                      </Badge>
                    ))}
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canEdit && (
                        <DropdownMenuItem onClick={() => handleEditUser(user)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          {t("settings.users.actions.edit")}
                        </DropdownMenuItem>
                      )}
                      {canEdit && (
                        <DropdownMenuItem onClick={() => handleToggleStatus(user)}>
                          {user.status === "active" ? (
                            <>
                              <UserX className="h-4 w-4 mr-2" />
                              {t("settings.users.actions.deactivate")}
                            </>
                          ) : (
                            <>
                              <UserCheck className="h-4 w-4 mr-2" />
                              {t("settings.users.actions.activate")}
                            </>
                          )}
                        </DropdownMenuItem>
                      )}
                      {canDelete && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            onClick={() => void handleDeleteUser(user)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            {t("settings.users.actions.delete")}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingUser ? t("settings.users.editUser") : t("settings.users.createUser")}
            </DialogTitle>
            <DialogDescription>
              {editingUser
                ? t("settings.users.editDescription")
                : t("settings.users.createDescription")
              }
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void handleSaveUser(new FormData(event.currentTarget))
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">{t("settings.users.fullName")}</Label>
                <Input 
                  id="name" 
                  name="name"
                  defaultValue={editingUser?.name}
                  required
                  disabled={Boolean(editingUser)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t("settings.users.email")}</Label>
                <Input 
                  id="email" 
                  name="email"
                  type="email"
                  defaultValue={editingUser?.email}
                  required
                  disabled={Boolean(editingUser)}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="department">{t("settings.users.department")}</Label>
                <Input 
                  id="department" 
                  name="department"
                  defaultValue={editingUser?.department}
                  disabled={Boolean(editingUser)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">{t("settings.users.status")}</Label>
                <Select name="status" defaultValue={editingUser?.status || "pending"} disabled={Boolean(editingUser)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t("settings.users.statuses.active")}</SelectItem>
                    <SelectItem value="inactive">{t("settings.users.statuses.inactive")}</SelectItem>
                    <SelectItem value="pending">{t("settings.users.statuses.pending")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("settings.users.roles")}</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {roles.map((role) => (
                  <div key={role.id} className="flex items-center gap-2">
                    <Checkbox
                      id={role.id}
                      checked={selectedRoles.includes(role.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedRoles(prev => [...prev, role.id])
                        } else {
                          setSelectedRoles(prev => prev.filter(r => r !== role.id))
                        }
                      }}
                    />
                    <Label htmlFor={role.id} className="text-sm font-normal">
                      {role.name}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSaving || !orgReady}>
                {editingUser ? t("settings.users.saveChanges") : t("settings.users.createUser")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {memberModal ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setMemberModal(null)
              setMemberError(null)
            }
          }}
          config={
            memberModal === "addByName"
              ? addOrgMemberForm(t, roleNameOptions)
              : memberModal === "addById"
                ? addUserToOrganizationForm(t, roleOptions)
                : memberModal === "updateRole"
                  ? updateOrgMemberRoleForm(t, roleNameOptions, memberSelectOptions)
                  : updateOrgMemberDetailsForm(t, memberSelectOptions, employeeSelectOptions)
          }
          isPending={
            addOrgMember.isPending ||
            addUserToOrganization.isPending ||
            updateOrgMemberDetails.isPending ||
            updateOrgMemberRole.isPending
          }
          closeOnSubmit={false}
          submitError={memberError}
          onSubmit={async (data) => {
            setMemberError(null)
            try {
              if (memberModal === "addByName") {
                await addOrgMember.mutateAsync(data)
              } else if (memberModal === "addById") {
                await addUserToOrganization.mutateAsync(data)
              } else if (memberModal === "updateRole") {
                await updateOrgMemberRole.mutateAsync({
                  userOrgId: data.userOrgId as string | number,
                  roleName: String(data.roleName ?? ""),
                })
              } else {
                await updateOrgMemberDetails.mutateAsync({
                  userOrgId: data.userOrgId as string | number,
                  params: {
                    jobTitle: data.jobTitle ? String(data.jobTitle) : null,
                    employeeId: data.employeeId ? String(data.employeeId) : null,
                    departmentId: null,
                  },
                })
              }
              await refetch()
              setMemberModal(null)
            } catch (error) {
              setMemberError(error instanceof Error ? error.message : String(error))
            }
          }}
        />
      ) : null}
    </div>
  )
}
