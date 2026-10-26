"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const pathname = usePathname()

  const BACK_NAV: Record<string, { href: string; label: string }> = {
    "/sign-up": { href: "/sign-in", label: t("auth.nav.backToSignIn") },
    "/forgot-password": { href: "/sign-in", label: t("auth.nav.backToSignIn") },
    "/reset-password": { href: "/forgot-password", label: t("auth.nav.requestNewLink") },
  }

  const back = BACK_NAV[pathname]

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="flex justify-center">
            <Image src="/brand/lumiere-logo-light.svg" alt={t("auth.appName")} width={96} height={96} className="dark:hidden" priority />
            <Image src="/brand/lumiere-logo-dark.svg" alt={t("auth.appName")} width={96} height={96} className="hidden dark:block" priority />
          </h1>
        </div>

        {back && (
          <div className="mb-4">
            <Link
              href={back.href}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-3.5" />
              {back.label}
            </Link>
          </div>
        )}

        {children}
      </div>
    </div>
  )
}
