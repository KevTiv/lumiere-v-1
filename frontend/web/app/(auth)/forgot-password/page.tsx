"use client"

import { useState } from "react"
import Link from "next/link"
import { Trans, useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@lumiere/ui/components/card"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import { redirectToWorkOsSignInForPasswordReset } from "@/app/actions/workos-auth"

const useWorkOsAuth = Boolean(process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI)

export default function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      setSubmitted(true)
    } finally {
      setLoading(false)
    }
  }

  if (useWorkOsAuth) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("auth.forgotPassword.title")}</CardTitle>
          <CardDescription>{t("auth.forgotPassword.descriptionWorkOs")}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <form action={redirectToWorkOsSignInForPasswordReset} className="space-y-2">
            <input type="hidden" name="returnTo" value="/sign-in" />
            <Button type="submit" size="lg" className="w-full">
              {t("auth.forgotPassword.openWorkOsReset")}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground text-center">
            {t("auth.forgotPassword.workOsResetHint")}
          </p>
          <Link href="/sign-in" className="block text-center text-sm font-medium hover:underline">
            {t("auth.forgotPassword.backToSignIn")}
          </Link>
        </CardContent>
      </Card>
    )
  }

  if (submitted) {
    return (
      <Card>
        <CardContent className="pt-8 pb-6 text-center space-y-4">
          <p className="text-base font-medium">{t("auth.forgotPassword.successTitle")}</p>
          <p className="text-sm text-muted-foreground">
            <Trans
              i18nKey="auth.forgotPassword.successDescription"
              values={{ email }}
              components={{ bold: <strong /> }}
            />
          </p>
          <Link href="/sign-in" className="text-sm font-medium hover:underline">
            {t("auth.forgotPassword.backToSignIn")}
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("auth.forgotPassword.title")}</CardTitle>
        <CardDescription>{t("auth.forgotPassword.description")}</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("auth.fields.email")}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder={t("auth.fields.emailPlaceholder")}
            />
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? t("auth.forgotPassword.submitting") : t("auth.forgotPassword.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
