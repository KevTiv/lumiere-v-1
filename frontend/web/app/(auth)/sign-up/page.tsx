"use client"

import { apiFetch } from '@/lib/api-fetch'
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@lumiere/ui/components/card"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import { redirectToWorkOsSignUp } from "@/app/actions/workos-auth"
import { phCapture, phCaptureException, phIdentify } from "@/lib/posthog-browser"

const useWorkOsAuth = Boolean(process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI)

export default function SignUpPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError(t("auth.errors.passwordMismatch"))
      return
    }
    setLoading(true)
    try {
      const res = await apiFetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        phCapture("user_sign_up_failed", { error: data.error ?? "unknown" })
        setError(data.error ?? t("auth.errors.signUpFailed"))
        return
      }
      phIdentify(email)
      phCapture("user_signed_up", { method: "email" })
      router.push(data.redirectTo ?? "/onboarding")
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
        <CardTitle>{t("auth.signUp.title")}</CardTitle>
        <CardDescription>{t("auth.signUp.description")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
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
            {loading ? t("auth.signUp.submitting") : t("auth.signUp.submit")}
          </Button>
        </form>

        {useWorkOsAuth && (
          <div className="space-y-3 border-t border-border pt-4">
            <form action={redirectToWorkOsSignUp} className="space-y-2">
              <input type="hidden" name="returnTo" value="/onboarding" />
              <Button type="submit" variant="outline" size="lg" className="w-full">
                {t("auth.signUp.continueWithWorkOs")}
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
          {t("auth.signUp.hasAccount")}{" "}
          <Link href="/sign-in" className="font-medium text-foreground hover:underline">
            {t("auth.signUp.signIn")}
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}
