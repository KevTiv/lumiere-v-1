"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { stdbBrowserQuery } from "@lumiere/stdb/browser-http"
import {
  resolveHttpSqlColumns,
  type QueryResourceKey,
} from "@lumiere/stdb/field-policy"
import {
  useAddCasbinRule,
  useRemoveCasbinRule,
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

type CasbinRuleRow = {
  id: bigint | number | string
  ptype: string
  v0?: string | null
  v1?: string | null
  v2?: string | null
  v3?: string | null
  metadata?: string | null
}

function parseFieldsFromRule(rule: CasbinRuleRow): string[] {
  if (!rule.metadata?.trim()) return []
  try {
    const parsed = JSON.parse(rule.metadata) as { fields?: unknown }
    if (!Array.isArray(parsed.fields)) return []
    return parsed.fields.filter((f): f is string => typeof f === "string")
  } catch {
    return []
  }
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
  const addCasbinRule = useAddCasbinRule(orgBigInt)
  const removeCasbinRule = useRemoveCasbinRule(orgBigInt)

  const [resourceKey, setResourceKey] = useState<QueryResourceKey>("contacts")
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set())
  const [existingRuleId, setExistingRuleId] = useState<bigint | null>(null)
  const [rules, setRules] = useState<CasbinRuleRow[]>([])
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
      const list = (await stdbBrowserQuery("casbin-rule")) as CasbinRuleRow[]
      const orgStr = String(organizationId)
      const filtered = list.filter(
        (r) =>
          r.ptype === "p" &&
          (r.v0 === roleId || r.v0 === roleName) &&
          r.v1 === orgStr &&
          r.v3 === "read",
      )
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
    const match = rules.find((r) => {
      const v2 = r.v2 ?? ""
      return v2 === resourceKey || v2 === resourceKey.replace(/-/g, "_")
    })
    if (match) {
      setExistingRuleId(BigInt(String(match.id)))
      setSelectedFields(new Set(parseFieldsFromRule(match)))
    } else {
      setExistingRuleId(null)
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
      if (existingRuleId != null) {
        await removeCasbinRule.mutateAsync(existingRuleId)
      }
      await addCasbinRule.mutateAsync({
        ptype: "p",
        v0: roleId,
        v1: String(organizationId),
        v2: resourceKey,
        v3: "read",
        metadata: JSON.stringify({ fields }),
      })
      await reloadRules()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    if (!canEdit || existingRuleId == null) return
    setSaving(true)
    setError(null)
    try {
      await removeCasbinRule.mutateAsync(existingRuleId)
      await reloadRules()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const configuredResources = useMemo(() => {
    return FIELD_POLICY_RESOURCES.filter((res) =>
      rules.some((r) => {
        const v2 = r.v2 ?? ""
        return v2 === res.key || v2 === res.key.replace(/-/g, "_")
      }),
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
            {existingRuleId != null ? (
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
