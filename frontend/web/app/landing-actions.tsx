"use client"

import { i18n as rootI18n, useTranslation as useRootTranslation } from "@lumiere/i18n"
import Link from "next/link"
import { buttonVariants } from "@lumiere/ui/components/button"

export function LandingActions({ authenticated }: { authenticated: boolean }) {
  useRootTranslation()
  if (authenticated) {
    return (
      <Link href="/overview" className={buttonVariants({ size: "lg" })}>
        {rootI18n.t("auth.ui.landingActions.openDashboard")}</Link>
    )
  }

  return (
    <>
      <Link href="/sign-in" className={buttonVariants({ size: "lg" })}>
        {rootI18n.t("auth.ui.landingActions.signIn")}</Link>
      <Link
        href="/sign-up"
        className={buttonVariants({ variant: "outline", size: "lg" })}
      >
        {rootI18n.t("auth.ui.landingActions.createAccount")}</Link>
    </>
  )
}


export function LandingIntro() {
  useRootTranslation()
  return <>
    <div className="mb-4 rounded-full border border-border bg-muted/40 px-3 py-1 text-sm text-muted-foreground">Lumiere ERP</div>
    <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">{rootI18n.t("auth.landing.heading")}</h1>
    <p className="mt-6 max-w-2xl text-lg text-muted-foreground">{rootI18n.t("auth.landing.description")}</p>
  </>
}
