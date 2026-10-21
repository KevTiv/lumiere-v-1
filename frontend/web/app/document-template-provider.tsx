"use client"

import { useCallback, useMemo, useState, type ReactNode } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { useDocumentTemplates } from "@lumiere/query-hooks/hooks/templates"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import {
  RichTextTemplateProvider,
  type RichTextTemplateOption,
} from "@lumiere/ui/components/rich-text-template-provider"
import { readRichTextTemplateHtml } from "@lumiere/ui/lib/document-template-designer"

/** Fetch once per requested session scope, shared by all modal text editors. */
export function DocumentTemplateProvider({
  children,
}: {
  children: ReactNode
}) {
  const { t } = useTranslation()
  const {
    identity,
    organizationId,
    activeCompanyId,
    activeCompanyReady,
    companyIds,
  } = useErpSession()
  const { currentUser, permissionsReady, checkPermission } = useRBAC()
  const readable =
    permissionsReady === true &&
    currentUser?.id === identity &&
    checkPermission("document_template", "read").allowed
  const scopeReady =
    Boolean(
      identity &&
      identity !== "unknown" &&
      organizationId &&
      organizationId > 0,
    ) &&
    activeCompanyReady === true &&
    activeCompanyId !== undefined &&
    (activeCompanyId === null || Boolean(companyIds?.includes(activeCompanyId)))
  const enabled = readable && scopeReady
  const scopeKey = JSON.stringify([
    identity,
    organizationId,
    activeCompanyId,
    enabled,
  ])
  const [requestedScope, setRequestedScope] = useState<string>()
  const requested = enabled && requestedScope === scopeKey
  const templatesQuery = useDocumentTemplates(organizationId ?? 0, requested, {
    identity,
    companyId: activeCompanyId,
  })

  const templates = useMemo<RichTextTemplateOption[]>(() => {
    if (!requested || templatesQuery.isError) return []
    return (templatesQuery.data ?? []).flatMap((row) => {
      if (
        (row.isActive ?? row.is_active) !== true ||
        (row.reportType ?? row.report_type) === "lumiere-invoice-profile-v1" ||
        !/^[1-9]\d*$/.test(String(row.id))
      )
        return []
      try {
        const html = readRichTextTemplateHtml(row.metadata)
        if (!html?.trim()) return []
        return [
          {
            id: String(row.id),
            name:
              row.name?.trim() ||
              t("documents.designer.untitled", {
                defaultValue: "Untitled template",
              }),
            html,
          },
        ]
      } catch {
        // Legacy, unsupported and invalid projects cannot be inserted as prose.
        return []
      }
    })
  }, [requested, templatesQuery.data, templatesQuery.isError, t])

  const onRequest = useCallback(() => {
    if (!enabled) return
    if (requested) void templatesQuery.refetch()
    else setRequestedScope(scopeKey)
  }, [enabled, requested, scopeKey, templatesQuery.refetch])

  return (
    <RichTextTemplateProvider
      enabled={enabled}
      scopeKey={scopeKey}
      templates={templates}
      status={
        !requested
          ? "idle"
          : templatesQuery.isError
            ? "error"
            : templatesQuery.isFetching
              ? "loading"
              : "ready"
      }
      error={
        templatesQuery.isError
          ? t("documents.templatePicker.loadError", {
              defaultValue: "Text templates could not be loaded. Try again.",
            })
          : undefined
      }
      onRequest={onRequest}
      managementHref={
        enabled &&
        typeof activeCompanyId === "number" &&
        checkPermission("document_template", "create").allowed
          ? "/documents?tab=document-templates"
          : undefined
      }
    >
      {children}
    </RichTextTemplateProvider>
  )
}
