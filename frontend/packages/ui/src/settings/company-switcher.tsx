"use client"

import { useMemo } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useTranslation } from "@lumiere/i18n"
import { Building2, ChevronDown, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function companyLabel(row: Record<string, unknown>): string {
  const name = row.name ?? row.displayName ?? row.legalName
  if (typeof name === "string" && name.trim()) return name.trim()
  const id = row.id
  return id != null ? `Company #${String(id)}` : "Company"
}

interface CompanySwitcherProps {
  collapsed?: boolean
  className?: string
}

export function CompanySwitcher({ collapsed = false, className }: CompanySwitcherProps) {
  const { t } = useTranslation()
  const { organizationId, setActiveCompanyId, activeCompanyReady } = useErpSession()
  const orgId = organizationId ?? 0
  const orgReady = organizationId != null && organizationId > 0
  const companiesQuery = useCompanies(orgId, orgReady)
  const operatingCompanyId = useOperatingCompanyId(organizationId)

  const companies = companiesQuery.data ?? []

  const currentCompany = useMemo(
    () => companies.find((row) => Number(row.id) === operatingCompanyId),
    [companies, operatingCompanyId],
  )

  if (!orgReady) return null

  if (companiesQuery.isLoading || !activeCompanyReady) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-sidebar-border px-2.5 py-2 text-sm text-muted-foreground",
          collapsed && "justify-center px-2",
          className,
        )}
        data-testid="company-switcher-loading"
      >
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        {!collapsed ? <span className="truncate">{t("nav.companySwitcher.loading")}</span> : null}
      </div>
    )
  }

  if (companies.length <= 1) {
    if (!currentCompany && operatingCompanyId == null) return null
    const label = currentCompany ? companyLabel(currentCompany) : t("nav.companySwitcher.singleCompany")
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-sm text-sidebar-foreground",
          collapsed && "justify-center px-2",
          className,
        )}
        title={label}
        data-testid="company-switcher-static"
      >
        <Building2 className="h-4 w-4 shrink-0" />
        {!collapsed ? <span className="truncate font-medium">{label}</span> : null}
      </div>
    )
  }

  const currentLabel = currentCompany
    ? companyLabel(currentCompany)
    : t("nav.companySwitcher.selectCompany")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-auto w-full justify-start gap-2 border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-sidebar-foreground hover:bg-sidebar-accent",
            collapsed && "w-auto justify-center px-2",
            className,
          )}
          title={collapsed ? currentLabel : undefined}
          data-testid="company-switcher-trigger"
        >
          <Building2 className="h-4 w-4 shrink-0" />
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">{currentLabel}</span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
            </>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          {t("nav.companySwitcher.switchCompany")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {companies.map((row) => {
          const id = Number(row.id)
          const label = companyLabel(row)
          const isCurrent = operatingCompanyId === id
          return (
            <DropdownMenuItem
              key={String(row.id)}
              onClick={() => setActiveCompanyId?.(id)}
              className="flex items-center gap-2 py-2"
              data-testid={`company-switcher-option-${id}`}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-xs font-medium">
                {label.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{label}</p>
                <p className="truncate text-xs text-muted-foreground">#{id}</p>
              </div>
              {isCurrent ? (
                <Badge variant="outline" className="text-xs">
                  {t("nav.companySwitcher.current")}
                </Badge>
              ) : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
