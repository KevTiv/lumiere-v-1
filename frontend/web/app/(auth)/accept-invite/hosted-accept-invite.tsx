'use client'

import { i18n as rootI18n, useTranslation as useRootTranslation } from "@lumiere/i18n"
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@lumiere/i18n'
import { Button } from '@lumiere/ui'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@lumiere/ui/components/card'
import { apiFetch } from '@/lib/api-fetch'
import { safeAuthReturnTo } from '@/lib/auth-mode'
import { redirectToWorkOsForInvite } from '@/app/actions/workos-auth'

export default function HostedAcceptInvitePage({
  signedIn,
  hasInvite,
}: {
  signedIn: boolean
  hasInvite: boolean
}) {
  useRootTranslation()
  const { t } = useTranslation()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function accept() {
    setLoading(true)
    setError(null)
    try {
      // The invite credential is sealed in an HTTP-only cookie and read by Next.
      const response = await apiFetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) {
        setError(response.status === 403
          ? rootI18n.t("auth.acceptInvite.errors.identityNotApproved")
          : response.status === 400
            ? rootI18n.t("auth.acceptInvite.errors.invalidInvitation")
            : rootI18n.t("auth.acceptInvite.errors.acceptFailed"))
        return
      }
      const result = (await response.json()) as { redirectTo?: string }
      router.replace(safeAuthReturnTo(result.redirectTo, '/overview'))
      router.refresh()
    } catch {
      setError(rootI18n.t("auth.acceptInvite.errors.serviceUnavailable"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('auth.acceptInvite.title')}</CardTitle>
        <CardDescription>{rootI18n.t("auth.ui.hostedAcceptInvite.onlyYourAdministratorApprovedWorkOSIdentityCanAcceptThis")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasInvite ? (
          <p role="alert" className="text-sm text-destructive">
            {rootI18n.t("auth.ui.hostedAcceptInvite.invitationMissingOrExpiredAskYourAdministratorFor")}</p>
        ) : !signedIn ? (
          <form action={redirectToWorkOsForInvite}>
            <Button type="submit" size="lg" className="w-full">
              {t('auth.acceptInvite.continueWithWorkOs')}
            </Button>
          </form>
        ) : (
          <Button type="button" size="lg" className="w-full" disabled={loading} onClick={accept}>
            {loading ? t('auth.acceptInvite.submitting') : t('auth.acceptInvite.submit')}
          </Button>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
      <CardFooter className="justify-center">
        <Link href="/sign-in" className="text-sm font-medium hover:underline">
          {t('auth.acceptInvite.goToSignIn')}
        </Link>
      </CardFooter>
    </Card>
  )
}
