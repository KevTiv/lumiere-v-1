"use client"

import { apiFetch } from '@/lib/api-fetch'
import { useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@lumiere/ui/components/card"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import {
  redirectToWorkOsSignIn,
} from "@/app/actions/workos-auth"
import { phCapture, phCaptureException, phIdentify } from "@/lib/posthog-browser"

import { safeAuthReturnTo } from '@/lib/auth-mode'
import { useWorkOsAuthMode } from '@/lib/auth-mode-context'


export default function SignInPage() {
  const useWorkOsAuth = useWorkOsAuthMode()
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const callbackUrl = safeAuthReturnTo(searchParams.get("callbackUrl"))

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const messages: Record<string, string> = {
    admission_denied: 'Your account needs administrator approval or explicit linking to an existing account.',
    membership_suspended: 'Your organization access is suspended. Contact your administrator.',
    invitation_required: 'You are signed in. Open your organization invitation to finish joining.',
    authentication_unavailable: 'Authentication is temporarily unavailable. Please retry.',
  }
  const [error, setError] = useState<string | null>(messages[searchParams.get('error') ?? ''] ?? null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await apiFetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        phCapture("user_sign_in_failed", { error: data.error ?? "unknown" })
        setError(data.error ?? t("auth.errors.signInFailed"))
        return
      }
      phIdentify(email)
      phCapture("user_signed_in", { method: "email" })
      const redirectTo = data.redirectTo === "/overview" ? callbackUrl : (data.redirectTo ?? callbackUrl)
      // Authentication changes the cookie-backed identity, organization, and
      // effective roles supplied by the root server layout. A client-side
      // transition preserves the anonymous root providers from `/sign-in`, so
      // the newly signed-in user can retain stale RBAC state until a reload.
      window.location.assign(redirectTo)
    } catch (err) {
      phCaptureException(err)
      setError(t("auth.errors.generic"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("auth.signIn.title")}</CardTitle>
        <CardDescription>{t("auth.signIn.description")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!useWorkOsAuth && (
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

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t("auth.fields.password")}</Label>
              <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">
                {t("auth.signIn.forgotPassword")}
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? t("auth.signIn.submitting") : t("auth.signIn.submit")}
          </Button>
          </form>
        )}

        {useWorkOsAuth && (
          <div className="space-y-3">
            <form action={redirectToWorkOsSignIn} className="space-y-2">
              <input type="hidden" name="returnTo" value={callbackUrl} />
              <Button type="submit" size="lg" className="w-full">
                {t("auth.signIn.continueWithWorkOs")}
              </Button>
            </form>
            <p className="text-center text-xs text-muted-foreground">
              {t("auth.signIn.workOsProvidersHint")}
            </p>
          </div>
        )}
      </CardContent>

      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          {useWorkOsAuth || process.env.NODE_ENV === 'production' ? 'Access is by invitation. Contact your administrator.' : <>
            {t("auth.signIn.noAccount")}{" "}
            <Link href="/sign-up" className="font-medium text-foreground hover:underline">
              {t("auth.signIn.createOne")}
            </Link>
          </>}
        </p>
      </CardFooter>
    </Card>
  )
}
