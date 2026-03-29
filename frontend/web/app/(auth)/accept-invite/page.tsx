"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@lumiere/ui/components/card"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import { redirectToWorkOsForInvite } from "@/app/actions/workos-auth"

const useWorkOsAuth = Boolean(process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI)

export default function AcceptInvitePage() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const inviteErr = searchParams.get("inviteErr")

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!token) {
    return (
      <Card>
        <CardContent className="pt-8 pb-6 text-center space-y-4">
          <p className="text-base font-medium">{t("auth.acceptInvite.invalidTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("auth.acceptInvite.invalidDescription")}</p>
          <Link href="/sign-in" className="text-sm font-medium hover:underline">
            {t("auth.acceptInvite.goToSignIn")}
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
      const res = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? t("auth.errors.inviteFailed"))
        return
      }
      router.push(data.redirectTo ?? "/overview")
    } catch {
      setError(t("auth.errors.generic"))
    } finally {
      setLoading(false)
    }
  }

  if (useWorkOsAuth) {
    const inviteErrKey =
      inviteErr === "invalid" || inviteErr === "missing"
        ? "auth.errors.inviteInvalid"
        : inviteErr === "used"
          ? "auth.errors.inviteUsed"
          : inviteErr === "expired"
            ? "auth.errors.inviteExpired"
            : null

    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("auth.acceptInvite.title")}</CardTitle>
          <CardDescription>{t("auth.acceptInvite.descriptionWorkOs")}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {inviteErrKey ? (
            <p className="text-sm text-destructive text-center">{t(inviteErrKey)}</p>
          ) : null}
          <form action={redirectToWorkOsForInvite} className="space-y-2">
            <input type="hidden" name="token" value={token ?? ""} />
            <Button type="submit" size="lg" className="w-full">
              {t("auth.acceptInvite.continueWithWorkOs")}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground text-center">
            {t("auth.acceptInvite.workOsInviteHint")}
          </p>
        </CardContent>

        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            {t("auth.acceptInvite.hasAccount")}{" "}
            <Link href="/sign-in" className="font-medium text-foreground hover:underline">
              {t("auth.acceptInvite.signIn")}
            </Link>
          </p>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("auth.acceptInvite.title")}</CardTitle>
        <CardDescription>{t("auth.acceptInvite.description")}</CardDescription>
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
              placeholder={t("auth.acceptInvite.emailPlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">{t("auth.fields.password")}</Label>
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
            <Label htmlFor="confirm">{t("auth.fields.confirmPassword")}</Label>
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
            {loading ? t("auth.acceptInvite.submitting") : t("auth.acceptInvite.submit")}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          {t("auth.acceptInvite.hasAccount")}{" "}
          <Link href="/sign-in" className="font-medium text-foreground hover:underline">
            {t("auth.acceptInvite.signIn")}
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}
