"use client"

import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ExternalLink, ShieldCheck } from "lucide-react"

const workOsEnabled = Boolean(
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
)

export function SsoSettings() {
  const { t } = useTranslation()
  const { identity } = useErpSession()

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
    </div>
  )
}
