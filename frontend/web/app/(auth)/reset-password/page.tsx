"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@lumiere/ui/components/card"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import { redirectToWorkOsSignInForPasswordReset } from "@/app/actions/workos-auth"

const useWorkOsAuth = Boolean(process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI)

export default function ResetPasswordPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get("token")

  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (useWorkOsAuth) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("auth.resetPassword.title")}</CardTitle>
          <CardDescription>{t("auth.resetPassword.descriptionWorkOs")}</CardDescription>
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

  if (!token) {
    return (
      <Card>
        <CardContent className="pt-8 pb-6 text-center space-y-4">
          <p className="text-base font-medium">{t("auth.resetPassword.invalidTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("auth.resetPassword.invalidDescription")}</p>
          <Link href="/forgot-password" className="text-sm font-medium hover:underline">
            {t("auth.resetPassword.requestNewLink")}
          </Link>
        </CardContent>
      </Card>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError(t("auth.errors.passwordMismatch"))
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? t("auth.errors.resetFailed"))
        return
      }
      router.push(data.redirectTo ?? "/overview")
    } catch {
      setError(t("auth.errors.generic"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("auth.resetPassword.title")}</CardTitle>
        <CardDescription>{t("auth.resetPassword.description")}</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">{t("auth.fields.newPassword")}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              placeholder={t("auth.fields.passwordPlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm">{t("auth.fields.confirmNewPassword")}</Label>
            <Input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? t("auth.resetPassword.submitting") : t("auth.resetPassword.submit")}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          {t("auth.resetPassword.linkNotWorking")}{" "}
          <Link href="/forgot-password" className="font-medium text-foreground hover:underline">
            {t("auth.resetPassword.requestNew")}
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}
