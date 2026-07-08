"use client"

import { useMemo, useState } from "react"
import { useRBAC } from "@/lib/rbac-context"
import { useErpSession } from "@lumiere/erp-session"
import { hasValidOrganizationId } from "@/lib/org-scoped"
import {
  useAuditLog,
  useCreateUserSession,
  useLogAuditEvent,
} from "@lumiere/query-hooks/hooks/auth"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Search,
  Filter,
  Download,
  Settings,
  FileText,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import type { AuditLogEntry } from "@/lib/rbac-types"
import { cn } from "@/lib/utils"
import { auditActionPillClass } from "@/lib/theme-colors"
import { FormModal } from "../forms/form-modal"
import { createUserSessionForm, logAuditEventForm } from "../lib/settings-platform-form-configs"
import { mergeSelectOptionsForFields } from "../lib/form-config-merge"

const actionIcons: Record<string, React.ReactNode> = {
  CREATE: <FileText className="h-4 w-4" />,
  UPDATE: <Settings className="h-4 w-4" />,
  DELETE: <AlertTriangle className="h-4 w-4" />,
  LOGIN: <CheckCircle className="h-4 w-4" />,
  LOGOUT: <CheckCircle className="h-4 w-4" />,
}

function actionPillClass(action: string): string {
  return auditActionPillClass[action] ?? auditActionPillClass[action.toLowerCase()] ?? "bg-muted text-muted-foreground"
}

function timestampToIso(raw: unknown): string {
  if (raw == null || raw === "") return new Date(0).toISOString()
  if (typeof raw === "object" && raw !== null) {
    const micros =
      (raw as { microsSinceUnixEpoch?: unknown }).microsSinceUnixEpoch ??
      (raw as { micros_since_unix_epoch?: unknown }).micros_since_unix_epoch
    if (micros != null) {
      const numeric = Number(micros)
      if (Number.isFinite(numeric)) {
        const date = new Date(numeric / 1000)
        if (!Number.isNaN(date.getTime())) return date.toISOString()
      }
    }
  }
  const numeric = Number(raw)
  if (!Number.isFinite(numeric)) return new Date(0).toISOString()
  const ms = numeric > 10_000_000_000 ? numeric / 1000 : numeric
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}

function formatAuditDetails(row: Record<string, unknown>): string {
  const tableName = String(row.tableName ?? row.table_name ?? "record")
  const recordId = row.recordId ?? row.record_id
  const changed = row.changedFields ?? row.changed_fields
  const newValues = row.newValues ?? row.new_values
  if (Array.isArray(changed) && changed.length > 0) {
    return `${tableName} #${String(recordId ?? "?")} — ${changed.map((field) => String(field)).join(", ")}`
  }
  if (typeof newValues === "string" && newValues.trim()) {
    const preview = newValues.length > 120 ? `${newValues.slice(0, 117)}…` : newValues
    return `${tableName} #${String(recordId ?? "?")} — ${preview}`
  }
  return `${tableName} #${String(recordId ?? "?")}`
}

function mapAuditRow(row: Record<string, unknown>): AuditLogEntry {
  const id = String(row.id ?? "")
  const action = String(row.action ?? "")
  const tableName = String(row.tableName ?? row.table_name ?? "")
  return {
    id,
    userId: "system",
    userName: "System",
    action: action ? `${action} · ${tableName}` : tableName,
    resource: tableName,
    details: formatAuditDetails(row),
    timestamp: timestampToIso(row.timestamp),
    ip: typeof row.ipAddress === "string" ? row.ipAddress : typeof row.ip_address === "string" ? row.ip_address : undefined,
  }
}

export function AuditLog() {
  const { t } = useTranslation()
  const { organizationId } = useErpSession()
  const orgReady = hasValidOrganizationId(organizationId)
  const orgBigInt = orgReady ? BigInt(organizationId) : 0n
  const auditQuery = useAuditLog(orgBigInt)
  const logAuditEvent = useLogAuditEvent(orgBigInt)
  const createUserSession = useCreateUserSession(orgBigInt)
  const { data: companies = [] } = useCompanies(organizationId ?? 0, orgReady)
  const { checkPermission } = useRBAC()
  const canManageAudit = checkPermission("admin:audit-log", "manage").allowed

  const companySelectOptions = useMemo(
    () =>
      companies.map((company) => ({
        value: String(company.id),
        label: String(company.name ?? company.id),
      })),
    [companies],
  )

  const logAuditFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(logAuditEventForm(t), {
        companyId: companySelectOptions,
      }),
    [t, companySelectOptions],
  )

  const [searchQuery, setSearchQuery] = useState("")
  const [actionFilter, setActionFilter] = useState<string>("all")
  const [adminModal, setAdminModal] = useState<"log" | "session" | null>(null)
  const [adminError, setAdminError] = useState<string | null>(null)

  const logs = useMemo(
    () => (auditQuery.data ?? []).map((row) => mapAuditRow(row as Record<string, unknown>)),
    [auditQuery.data],
  )

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.userName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.resource.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.details?.toLowerCase().includes(searchQuery.toLowerCase())

    const actionPrefix = log.action.split(" · ")[0]?.toLowerCase() ?? log.action.toLowerCase()
    const matchesAction =
      actionFilter === "all" ||
      log.resource.toLowerCase().includes(actionFilter) ||
      actionPrefix.startsWith(actionFilter)

    return matchesSearch && matchesAction
  })

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return timestamp
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)
  }

  const handleExport = () => {
    const csv = [
      ["Timestamp", "User", "Action", "Resource", "Details", "IP"],
      ...filteredLogs.map((log) => [
        log.timestamp,
        log.userName,
        log.action,
        log.resource,
        log.details || "",
        log.ip || "",
      ]),
    ]
      .map((row) => row.join(","))
      .join("\n")

    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `audit-log-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
  }

  return (
    <div className="space-y-6" data-testid="audit-log-panel">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("settings.auditLog.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="audit-log-search"
            />
          </div>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-40" data-testid="audit-log-filter">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder={t("settings.auditLog.filter")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("settings.auditLog.allActions")}</SelectItem>
              <SelectItem value="create">CREATE</SelectItem>
              <SelectItem value="update">UPDATE</SelectItem>
              <SelectItem value="delete">DELETE</SelectItem>
              <SelectItem value="crm">CRM</SelectItem>
              <SelectItem value="sale">Sales</SelectItem>
              <SelectItem value="account">Accounting</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageAudit && orgReady ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setAdminError(null)
                  setAdminModal("log")
                }}
              >
                {t("settings.adminOps.audit.logEventButton")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setAdminError(null)
                  setAdminModal("session")
                }}
              >
                {t("settings.adminOps.sessions.createButton")}
              </Button>
            </>
          ) : null}
          <Button variant="outline" onClick={handleExport} className="gap-2">
            <Download className="h-4 w-4" />
            {t("settings.auditLog.exportCsv")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-primary" />
            {t("settings.auditLog.activityLog", { count: filteredLogs.length })}
            {auditQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {auditQuery.isLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading audit log…
            </div>
          ) : null}
          {auditQuery.isError ? (
            <p className="p-6 text-sm text-destructive">
              {auditQuery.error instanceof Error
                ? auditQuery.error.message
                : "Unable to load audit log"}
            </p>
          ) : null}
          {!auditQuery.isLoading && filteredLogs.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="audit-log-empty">
              No audit entries match your filters yet.
            </p>
          ) : null}
          <div className="divide-y divide-border" data-testid="audit-log-list">
            {filteredLogs.map((log) => {
              const actionKey = log.action.split(" · ")[0] ?? log.action
              return (
                <div
                  key={log.id}
                  data-testid={`audit-log-entry-${log.id}`}
                  className="flex items-start justify-between p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className={cn("p-2 rounded-lg", actionPillClass(actionKey))}>
                      {actionIcons[actionKey] || <Settings className="h-4 w-4" />}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{log.userName}</span>
                        <Badge variant="outline" className="text-xs">
                          {log.action}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{log.details}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{formatTimestamp(log.timestamp)}</span>
                        {log.ip ? (
                          <>
                            <span className="text-border">•</span>
                            <span>IP: {log.ip}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {adminModal ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setAdminModal(null)
              setAdminError(null)
            }
          }}
          config={adminModal === "log" ? logAuditFormConfig : createUserSessionForm(t)}
          isPending={logAuditEvent.isPending || createUserSession.isPending}
          closeOnSubmit={false}
          submitError={adminError}
          onSubmit={async (data) => {
            setAdminError(null)
            try {
              if (adminModal === "log") {
                const changedRaw = String(data.changedFields ?? "")
                const companyRaw = data.companyId
                const companyId =
                  companyRaw != null && String(companyRaw).trim() !== ""
                    ? (typeof companyRaw === "object" ? null : companyRaw)
                    : null
                await logAuditEvent.mutateAsync({
                  companyId: companyId as string | number | bigint | null,
                  tableName: String(data.tableName ?? ""),
                  recordId: data.recordId as string | number,
                  action: String(data.action ?? ""),
                  oldValues: data.oldValues ? String(data.oldValues) : null,
                  newValues: data.newValues ? String(data.newValues) : null,
                  changedFields: changedRaw
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                  sessionId: null,
                  ipAddress: null,
                  userAgent: null,
                  metadata: null,
                })
              } else {
                const expiresRaw = String(data.expiresAt ?? "").trim()
                const millis = Date.parse(expiresRaw)
                if (!Number.isFinite(millis)) throw new Error("expiresAt must be a valid date/time")
                await createUserSession.mutateAsync({
                  sessionToken: String(data.sessionToken ?? ""),
                  ipAddress: data.ipAddress ? String(data.ipAddress) : null,
                  userAgent: data.userAgent ? String(data.userAgent) : null,
                  deviceInfo: null,
                  expiresAtMicros: BigInt(millis) * 1000n,
                  metadata: null,
                })
              }
              setAdminModal(null)
            } catch (error) {
              setAdminError(error instanceof Error ? error.message : String(error))
            }
          }}
        />
      ) : null}
    </div>
  )
}
