"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import { useRBAC } from "@/lib/rbac-context"
import { hasValidOrganizationId } from "@/lib/org-scoped"
import { useLinkWorkosUser } from "@lumiere/query-hooks/hooks/auth"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ExternalLink, KeyRound, ShieldCheck } from "lucide-react"

const workOsEnabled = Boolean(
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
)

export function SsoSettings() {
  const { t } = useTranslation()
  const { organizationId, identity } = useErpSession()
  const { isAdmin } = useRBAC()
  const adminUser = isAdmin()
  const orgReady = hasValidOrganizationId(organizationId)
  const linkWorkos = useLinkWorkosUser(orgReady ? BigInt(organizationId) : 0n)

  const [targetIdentity, setTargetIdentity] = useState("")
  const [workosUserId, setWorkosUserId] = useState("")
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linkSuccess, setLinkSuccess] = useState(false)

  const handleLink = async () => {
    setLinkError(null)
    setLinkSuccess(false)
    try {
      await linkWorkos.mutateAsync({
        targetIdentity: targetIdentity.trim(),
        workosUserId: workosUserId.trim(),
      })
      setLinkSuccess(true)
      setTargetIdentity("")
      setWorkosUserId("")
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-6" data-testid="sso-settings">
      <div>
        <h3 className="text-lg font-medium">{t("settings.sso.title")}</h3>
        <p className="text-sm text-muted-foreground mt-1">{t("settings.sso.description")}</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">{t("settings.sso.statusTitle")}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("settings.sso.provider")}</span>
            <Badge variant={workOsEnabled ? "default" : "secondary"}>
              {workOsEnabled ? t("settings.sso.enabled") : t("settings.sso.disabled")}
            </Badge>
          </div>
          {workOsEnabled ? (
            <p className="text-sm text-muted-foreground">{t("settings.sso.enabledHint")}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("settings.sso.disabledHint")}</p>
          )}
          {workOsEnabled ? (
            <a
              href="/sign-in"
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              <ExternalLink className="h-4 w-4" />
              {t("settings.sso.openSignIn")}
            </a>
          ) : null}
        </CardContent>
      </Card>

      {identity ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("settings.sso.currentSession")}</CardTitle>
            <CardDescription>{t("settings.sso.currentSessionHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <code className="text-xs break-all font-mono bg-muted px-2 py-1 rounded">
              {identity}
            </code>
          </CardContent>
        </Card>
      ) : null}

      {adminUser && orgReady ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">{t("settings.sso.linkTitle")}</CardTitle>
            </div>
            <CardDescription>{t("settings.sso.linkDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sso-target-identity">{t("settings.sso.targetIdentity")}</Label>
              <Input
                id="sso-target-identity"
                value={targetIdentity}
                onChange={(e) => setTargetIdentity(e.target.value)}
                placeholder="0x…"
                data-testid="sso-target-identity"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sso-workos-user-id">{t("settings.sso.workosUserId")}</Label>
              <Input
                id="sso-workos-user-id"
                value={workosUserId}
                onChange={(e) => setWorkosUserId(e.target.value)}
                placeholder="user_…"
                data-testid="sso-workos-user-id"
              />
            </div>
            {linkError ? <p className="text-sm text-destructive">{linkError}</p> : null}
            {linkSuccess ? (
              <p className="text-sm text-green-600 dark:text-green-400">{t("settings.sso.linkSuccess")}</p>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={linkWorkos.isPending || !targetIdentity.trim() || !workosUserId.trim()}
              data-testid="sso-link-submit"
              onClick={() => void handleLink()}
            >
              {t("settings.sso.linkSubmit")}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
