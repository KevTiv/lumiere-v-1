"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { stdbBrowserQuery } from "@lumiere/stdb/browser-http"
import {
  resolveHttpSqlColumns,
  type QueryResourceKey,
} from "@lumiere/stdb/field-policy"
import {
  useGrantFieldPermission,
  useRevokeFieldPermission,
} from "@lumiere/query-hooks/hooks/auth"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

/** Common query resources admins restrict for column-level API reads. */
const FIELD_POLICY_RESOURCES: readonly { key: QueryResourceKey; label: string }[] = [
  { key: "contacts", label: "Contacts" },
  { key: "leads", label: "Leads" },
  { key: "opportunities", label: "Opportunities" },
  { key: "products", label: "Products" },
  { key: "sale-orders", label: "Sales orders" },
  { key: "purchase-orders", label: "Purchase orders" },
  { key: "employees", label: "Employees" },
  { key: "account-moves", label: "Journal entries" },
  { key: "activities", label: "Activities" },
  { key: "documents", label: "Documents" },
]

type FieldPermissionRow = {
  id: bigint | number | string
  organization_id?: number | null
  organizationId?: number | null
  role_id?: bigint | number | string | null
  roleId?: bigint | number | string | null
  subject?: unknown
  resource?: string | null
  action?: string | Record<string, unknown> | null
  allowed_fields?: string[] | null
  allowedFields?: string[] | null
}

function actionLabel(action: FieldPermissionRow["action"]): string {
  if (typeof action === "string") return action.toLowerCase()
  if (action && typeof action === "object") {
    const key = Object.keys(action)[0]
    if (key) return key.toLowerCase()
  }
  return ""
}

function roleIdFromRow(row: FieldPermissionRow): string | null {
  const direct = row.role_id ?? row.roleId
  if (direct != null && String(direct).trim() !== "") {
    return String(direct)
  }
  const subject = row.subject
  if (subject && typeof subject === "object") {
    const obj = subject as Record<string, unknown>
    const role = obj.Role ?? obj.role
    if (role != null && String(role).trim() !== "") {
      return String(role)
    }
  }
  return null
}

function allowedFieldsFromRow(row: FieldPermissionRow): string[] {
  const raw = row.allowed_fields ?? row.allowedFields ?? []
  if (!Array.isArray(raw)) return []
  return raw.filter((f): f is string => typeof f === "string")
}

function resourceMatchesRow(resourceKey: QueryResourceKey, resource: string): boolean {
  return resource === resourceKey || resource === resourceKey.replace(/-/g, "_")
}

export interface FieldPermissionsEditorProps {
  organizationId: number
  roleId: string
  roleName: string
  canEdit: boolean
  className?: string
}

export function FieldPermissionsEditor({
  organizationId,
  roleId,
  roleName,
  canEdit,
  className,
}: FieldPermissionsEditorProps) {
  const { t } = useTranslation()
  const orgBigInt = BigInt(organizationId)
  const grantFieldPermission = useGrantFieldPermission(orgBigInt)
  const revokeFieldPermission = useRevokeFieldPermission(orgBigInt)

  const [resourceKey, setResourceKey] = useState<QueryResourceKey>("contacts")
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set())
  const [existingPermissionId, setExistingPermissionId] = useState<bigint | null>(null)
  const [rules, setRules] = useState<FieldPermissionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const availableColumns = useMemo(
    () => resolveHttpSqlColumns(resourceKey, undefined),
    [resourceKey],
  )

  const reloadRules = useCallback(async () => {
    if (!organizationId || !roleId) {
      setRules([])
      return
    }
    setLoading(true)
    try {
      const list = (await stdbBrowserQuery("field-permissions")) as FieldPermissionRow[]
      const orgStr = String(organizationId)
      const filtered = list.filter((row) => {
        const org = String(row.organization_id ?? row.organizationId ?? "")
        if (org !== orgStr) return false
        if (actionLabel(row.action) !== "read") return false
        const rowRoleId = roleIdFromRow(row)
        return rowRoleId === roleId || rowRoleId === roleName
      })
      setRules(filtered)
    } catch {
      setRules([])
    } finally {
      setLoading(false)
    }
  }, [organizationId, roleId, roleName])

  useEffect(() => {
    void reloadRules()
  }, [reloadRules])

  useEffect(() => {
    const match = rules.find((row) => resourceMatchesRow(resourceKey, String(row.resource ?? "")))
    if (match) {
      setExistingPermissionId(BigInt(String(match.id)))
      setSelectedFields(new Set(allowedFieldsFromRow(match)))
    } else {
      setExistingPermissionId(null)
      setSelectedFields(new Set(availableColumns))
    }
  }, [rules, resourceKey, availableColumns])

  const toggleField = (field: string) => {
    setSelectedFields((prev) => {
      const next = new Set(prev)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }

  const handleSave = async () => {
    if (!canEdit) return
    const fields = [...selectedFields].sort()
    if (fields.length === 0) {
      setError(t("settings.fieldPermissions.noFieldsSelected"))
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (existingPermissionId != null) {
        await revokeFieldPermission.mutateAsync(existingPermissionId)
      }
      await grantFieldPermission.mutateAsync({
        roleId,
        resource: resourceKey,
        action: "Read",
        allowedFields: fields,
      })
      await reloadRules()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    if (!canEdit || existingPermissionId == null) return
    setSaving(true)
    setError(null)
    try {
      await revokeFieldPermission.mutateAsync(existingPermissionId)
      await reloadRules()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const configuredResources = useMemo(() => {
    return FIELD_POLICY_RESOURCES.filter((res) =>
      rules.some((row) => resourceMatchesRow(res.key, String(row.resource ?? ""))),
    )
  }, [rules])

  return (
    <Card className={cn(className)} data-testid="field-permissions-editor">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("settings.fieldPermissions.title")}</CardTitle>
        <CardDescription>{t("settings.fieldPermissions.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {configuredResources.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {configuredResources.map((res) => (
              <Badge key={res.key} variant="secondary" className="text-xs">
                {res.label}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("settings.fieldPermissions.noneConfigured")}</p>
        )}

        <div className="space-y-2">
          <Label>{t("settings.fieldPermissions.resource")}</Label>
          <Select
            value={resourceKey}
            onValueChange={(v) => setResourceKey(v as QueryResourceKey)}
          >
            <SelectTrigger data-testid="field-permissions-resource">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_POLICY_RESOURCES.map((res) => (
                <SelectItem key={res.key} value={res.key}>
                  {res.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto rounded-md border p-3">
            {availableColumns.map((col) => (
              <label key={col} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={selectedFields.has(col)}
                  disabled={!canEdit}
                  onCheckedChange={() => toggleField(col)}
                />
                <span className="font-mono text-xs">{col}</span>
              </label>
            ))}
          </div>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={saving || loading}
              data-testid="field-permissions-save"
              onClick={() => void handleSave()}
            >
              {t("settings.fieldPermissions.save")}
            </Button>
            {existingPermissionId != null ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving || loading}
                onClick={() => void handleClear()}
              >
                {t("settings.fieldPermissions.clear")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
