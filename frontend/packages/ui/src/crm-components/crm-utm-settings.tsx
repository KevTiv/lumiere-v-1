"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import { stdbBrowserQuery } from "@lumiere/stdb/browser-http"
import {
  createUtmCampaign,
  createUtmMedium,
  createUtmSource,
  updateUtmCampaign,
  updateUtmMedium,
  updateUtmSource,
} from "@lumiere/stdb/client-ui-bridge"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

interface UtmRow {
  id: bigint
  name: string
  isActive: boolean
}

const UTM_RESOURCE: Record<"utm_campaign" | "utm_medium" | "utm_source", string> = {
  utm_campaign: "utm-campaigns",
  utm_medium: "utm-media",
  utm_source: "utm-sources",
}

function useOrgUtmTable<T extends UtmRow>(
  organizationId: number,
  table: "utm_campaign" | "utm_medium" | "utm_source",
  refreshKey: number,
): T[] {
  const [rows, setRows] = useState<T[]>([])

  useEffect(() => {
    if (!organizationId) {
      setRows([])
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const resource = UTM_RESOURCE[table]
        const list = await stdbBrowserQuery(resource)
        if (cancelled) return
        const filtered = list.filter(r => Number(r.organizationId) === organizationId)
        setRows(
          filtered.map(r => ({
            id: BigInt(String(r.id ?? 0)),
            name: String(r.name ?? ""),
            isActive: Boolean(r.isActive),
          })) as T[],
        )
      } catch {
        if (!cancelled) setRows([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [organizationId, table, refreshKey])

  return rows
}

interface UtmColumnProps {
  organizationId: number
  title: string
  description: string
  namePlaceholder: string
  table: "utm_campaign" | "utm_medium" | "utm_source"
  refreshKey: number
  onRefresh: () => void
  onCreate: (name: string, isActive: boolean) => Promise<void>
  onToggleActive: (id: bigint, name: string, isActive: boolean) => Promise<void>
}

function UtmColumn({
  organizationId,
  title,
  description,
  namePlaceholder,
  table,
  refreshKey,
  onRefresh,
  onCreate,
  onToggleActive,
}: UtmColumnProps) {
  const { t } = useTranslation()
  const rows = useOrgUtmTable(organizationId, table, refreshKey)
  const [name, setName] = useState("")
  const [activeNew, setActiveNew] = useState(true)
  const [busy, setBusy] = useState(false)

  const handleAdd = async () => {
    const n = name.trim()
    if (!n || !organizationId) return
    try {
      setBusy(true)
      await onCreate(n, activeNew)
      setName("")
      onRefresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 flex-1">
        <div className="space-y-2">
          <Label htmlFor={`${table}-name`}>{t("crm.attribution.nameLabel")}</Label>
          <Input
            id={`${table}-name`}
            placeholder={namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Switch id={`${table}-active`} checked={activeNew} onCheckedChange={setActiveNew} />
            <Label htmlFor={`${table}-active`} className="text-sm font-normal">
              {t("crm.attribution.activeByDefault")}
            </Label>
          </div>
          <Button type="button" size="sm" disabled={busy || !name.trim()} onClick={() => void handleAdd()}>
            {t("crm.attribution.add")}
          </Button>
        </div>
        <div className="border-t pt-3 space-y-2 max-h-72 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("crm.attribution.empty")}</p>
          ) : (
            rows.map((r) => (
              <div
                key={String(r.id)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm",
                  !r.isActive && "opacity-60",
                )}
              >
                <span className="truncate font-medium">{r.name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Switch
                    checked={r.isActive}
                    onCheckedChange={(v) => {
                      void (async () => {
                        await onToggleActive(r.id, r.name, v)
                        onRefresh()
                      })()
                    }}
                    aria-label={t("crm.attribution.toggleActive")}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export interface CrmUtmSettingsProps {
  organizationId: number
  className?: string
}

export function CrmUtmSettings({ organizationId, className }: CrmUtmSettingsProps) {
  const { t } = useTranslation()
  const { identity } = useErpSession()
  const [utmRefresh, setUtmRefresh] = useState(0)

  const org = BigInt(organizationId)

  const mkCreateCampaign = useCallback(
    async (name: string, isActive: boolean) => {
      await createUtmCampaign(org, { name, isActive })
    },
    [org],
  )
  const mkUpdateCampaign = useCallback(
    async (id: bigint, name: string, isActive: boolean) => {
      await updateUtmCampaign(org, id, { name, isActive })
    },
    [org],
  )

  const mkCreateMedium = useCallback(
    async (name: string, isActive: boolean) => {
      await createUtmMedium(org, { name, isActive })
    },
    [org],
  )
  const mkUpdateMedium = useCallback(
    async (id: bigint, name: string, isActive: boolean) => {
      await updateUtmMedium(org, id, { name, isActive })
    },
    [org],
  )

  const mkCreateSource = useCallback(
    async (name: string, isActive: boolean) => {
      await createUtmSource(org, { name, isActive })
    },
    [org],
  )
  const mkUpdateSource = useCallback(
    async (id: bigint, name: string, isActive: boolean) => {
      await updateUtmSource(org, id, { name, isActive })
    },
    [org],
  )

  if (!organizationId) {
    return <p className="text-sm text-muted-foreground">{t("crm.attribution.needOrg")}</p>
  }

  if (!identity) {
    return <p className="text-sm text-muted-foreground">{t("crm.attribution.needConnection")}</p>
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div>
        <h2 className="text-lg font-semibold">{t("crm.attribution.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("crm.attribution.subtitle")}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <UtmColumn
          organizationId={organizationId}
          title={t("crm.attribution.campaigns")}
          description={t("crm.attribution.campaignsHint")}
          namePlaceholder={t("crm.attribution.campaignPlaceholder")}
          table="utm_campaign"
          refreshKey={utmRefresh}
          onRefresh={() => setUtmRefresh(k => k + 1)}
          onCreate={mkCreateCampaign}
          onToggleActive={mkUpdateCampaign}
        />
        <UtmColumn
          organizationId={organizationId}
          title={t("crm.attribution.media")}
          description={t("crm.attribution.mediaHint")}
          namePlaceholder={t("crm.attribution.mediumPlaceholder")}
          table="utm_medium"
          refreshKey={utmRefresh}
          onRefresh={() => setUtmRefresh(k => k + 1)}
          onCreate={mkCreateMedium}
          onToggleActive={mkUpdateMedium}
        />
        <UtmColumn
          organizationId={organizationId}
          title={t("crm.attribution.sources")}
          description={t("crm.attribution.sourcesHint")}
          namePlaceholder={t("crm.attribution.sourcePlaceholder")}
          table="utm_source"
          refreshKey={utmRefresh}
          onRefresh={() => setUtmRefresh(k => k + 1)}
          onCreate={mkCreateSource}
          onToggleActive={mkUpdateSource}
        />
      </div>
    </div>
  )
}
