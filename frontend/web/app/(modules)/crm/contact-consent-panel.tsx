"use client"

import { useMemo, useState } from "react"
import { PlusIcon, ShieldIcon } from "lucide-react"

import { useTranslation } from "@lumiere/i18n"
import { useRecordPrivacyConsent } from "@lumiere/query-hooks/hooks/auth"
import { usePrivacyConsents } from "@lumiere/query-hooks/hooks/crm"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Row = Record<string, unknown>

function optionValue(value: unknown): unknown {
  if (value != null && typeof value === "object" && "some" in value) {
    return (value as { some: unknown }).some
  }
  return value
}

function asId(value: unknown): bigint | null {
  const raw = optionValue(value)
  if (raw == null || raw === "") return null
  try {
    return typeof raw === "bigint" ? raw : BigInt(String(raw))
  } catch {
    return null
  }
}

function formatWhen(value: unknown): string {
  const raw = optionValue(value)
  if (raw == null) return "—"
  if (typeof raw === "object" && raw !== null && "microsSinceUnixEpoch" in raw) {
    const micros = Number((raw as { microsSinceUnixEpoch: bigint | number }).microsSinceUnixEpoch)
    if (!Number.isFinite(micros) || micros <= 0) return "—"
    return new Date(micros / 1000).toLocaleString()
  }
  return String(raw)
}

export interface ContactConsentPanelProps {
  organizationId: number
  contactId: bigint
}

export function ContactConsentPanel({ organizationId, contactId }: ContactConsentPanelProps) {
  const { t } = useTranslation()
  const organization = BigInt(organizationId)
  const { data: rows = [], isLoading } = usePrivacyConsents(organization)
  const recordConsent = useRecordPrivacyConsent(organization)

  const [consentType, setConsentType] = useState("marketing")
  const [granted, setGranted] = useState("true")
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const history = useMemo(
    () =>
      (rows as Row[])
        .filter((row) => asId(row.contactId ?? row.contact_id) === contactId)
        .sort((a, b) => {
          const aMs = Number(
            (optionValue(a.grantedAt ?? a.granted_at ?? a.revokedAt ?? a.revoked_at) as
              | { microsSinceUnixEpoch?: number }
              | null)?.microsSinceUnixEpoch ?? 0,
          )
          const bMs = Number(
            (optionValue(b.grantedAt ?? b.granted_at ?? b.revokedAt ?? b.revoked_at) as
              | { microsSinceUnixEpoch?: number }
              | null)?.microsSinceUnixEpoch ?? 0,
          )
          return bMs - aMs
        }),
    [rows, contactId],
  )

  async function onSubmit() {
    setError(null)
    try {
      await recordConsent.mutateAsync({
        contactId,
        consentType: consentType.trim() || "marketing",
        granted: granted === "true",
        ipAddress: null,
        userAgent: null,
        metadata: null,
      })
      setFormOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Card data-testid="contact-consent-panel">
      <CardHeader>
        <CardTitle>{t("crm.consent.title", "Consent history")}</CardTitle>
        <CardDescription>
          {t("crm.consent.description", "Grant and revocation decisions for this contact.")}
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="contact-consent-record"
            onClick={() => setFormOpen((v) => !v)}
          >
            <PlusIcon className="size-4" />
            {t("crm.consent.record", "Record consent")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {formOpen ? (
          <div className="grid gap-3 rounded-md border p-3" data-testid="contact-consent-form">
            <div className="grid gap-1.5">
              <Label htmlFor="consent-type">{t("crm.consent.type", "Consent type")}</Label>
              <Input
                id="consent-type"
                value={consentType}
                onChange={(e) => setConsentType(e.target.value)}
                placeholder="marketing"
                data-testid="contact-consent-type"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("crm.consent.decision", "Decision")}</Label>
              <Select value={granted} onValueChange={setGranted}>
                <SelectTrigger data-testid="contact-consent-granted">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">{t("crm.consent.granted", "Granted")}</SelectItem>
                  <SelectItem value="false">{t("crm.consent.revoked", "Revoked")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button
              type="button"
              size="sm"
              disabled={recordConsent.isPending}
              onClick={() => void onSubmit()}
              data-testid="contact-consent-submit"
            >
              {t("crm.consent.save", "Save")}
            </Button>
          </div>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("crm.consent.loading", "Loading…")}</p>
        ) : history.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShieldIcon />
              </EmptyMedia>
              <EmptyTitle>{t("crm.consent.emptyTitle", "No consent recorded")}</EmptyTitle>
              <EmptyDescription>
                {t("crm.consent.emptyDescription", "Record a grant or revocation before outbound messaging.")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent />
          </Empty>
        ) : (
          <ul className="divide-y rounded-md border" data-testid="contact-consent-list">
            {history.map((row) => {
              const id = String(row.id ?? "")
              const grantedFlag = Boolean(row.granted)
              return (
                <li key={id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{String(row.consentType ?? row.consent_type ?? "—")}</div>
                    <div className="text-muted-foreground">
                      {grantedFlag
                        ? formatWhen(row.grantedAt ?? row.granted_at)
                        : formatWhen(row.revokedAt ?? row.revoked_at)}
                    </div>
                  </div>
                  <Badge variant={grantedFlag ? "default" : "destructive"}>
                    {grantedFlag
                      ? t("crm.consent.granted", "Granted")
                      : t("crm.consent.revoked", "Revoked")}
                  </Badge>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
