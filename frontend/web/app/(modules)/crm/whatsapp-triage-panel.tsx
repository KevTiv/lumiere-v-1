"use client"

import { useEffect, useRef, useState } from "react"
import { z } from "zod"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { whatsappRequest } from "@/lib/whatsapp-dispatch"

const responseSchema = z.object({
  data: z.array(z.object({
    id: z.string(), state: z.string(), reason: z.string().nullable(), kind: z.string(),
    sender: z.string().nullable(), attempts: z.number(), canRetry: z.boolean(),
  })),
  limit: z.number(),
})

type Item = z.infer<typeof responseSchema>["data"][number]

export function WhatsAppTriagePanel({ companyId, accountId }: { companyId: string; accountId: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const busyRef = useRef(false)
  const mounted = useRef(true)
  const base = `/api/whatsapp/accounts/${encodeURIComponent(accountId)}/triage`

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  async function refresh() {
    const result = await whatsappRequest(`${base}?companyId=${encodeURIComponent(companyId)}`, responseSchema)
    if (mounted.current) setItems(result.data)
  }

  async function load() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try { await refresh() } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Exception queue is unavailable")
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function retry(item: Item) {
    const reason = reasons[item.id]?.trim()
    if (busyRef.current || !item.canRetry || !reason) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await whatsappRequest(`${base}/${encodeURIComponent(item.id)}/retry`, z.object({ state: z.literal("pending") }), {
        method: "POST", body: JSON.stringify({ companyId, reason }),
      })
      await refresh()
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Retry outcome is unconfirmed; refresh before retrying")
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  if (!open) return <Button size="sm" variant="ghost" onClick={() => { setOpen(true); void load() }}>
    {t("crm.whatsapp.triage", "Review incoming WhatsApp exceptions")}
  </Button>

  return <section className="min-w-0 space-y-3 rounded-md border p-3" aria-label={t("crm.whatsapp.exceptions", "Incoming exceptions")}>
    <p className="text-sm text-muted-foreground">{t("crm.whatsapp.triageNotice", "Administration only. Match an unknown sender in CRM or resolve the processing issue before retrying. Conflicting provider events cannot be replayed.")}</p>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    <ul className="max-h-80 space-y-3 overflow-y-auto">
      {items.map((item) => <li key={item.id} className="space-y-2 rounded border p-2">
        <p className="break-words text-sm">{item.sender ?? "—"} · {item.kind} · {item.state}</p>
        <p className="break-words text-xs text-muted-foreground">{item.reason}</p>
        {item.canRetry && <>
          <Label htmlFor={`wa-retry-${item.id}`}>{t("crm.whatsapp.retryReason", "What did you resolve?")}</Label>
          <Input id={`wa-retry-${item.id}`} maxLength={256} value={reasons[item.id] ?? ""} disabled={busy}
            onChange={(event) => setReasons((current) => ({ ...current, [item.id]: event.target.value }))} />
          <Button size="sm" variant="outline" disabled={busy || !reasons[item.id]?.trim()} onClick={() => void retry(item)}>
            {t("crm.whatsapp.retryProcessing", "Retry incoming processing")}
          </Button>
        </>}
      </li>)}
    </ul>
    {!busy && !error && items.length === 0 && <p role="status">{t("crm.whatsapp.noExceptions", "No incoming exceptions in this sender’s queue.")}</p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}>{t("common.refresh", "Refresh")}</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>{t("common.close", "Close")}</Button>
    </div>
  </section>
}
