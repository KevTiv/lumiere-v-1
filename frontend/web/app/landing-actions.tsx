"use client"

import Link from "next/link"
import { buttonVariants } from "@lumiere/ui/components/button"

export function LandingActions({ authenticated }: { authenticated: boolean }) {
  if (authenticated) {
    return (
      <Link href="/overview" className={buttonVariants({ size: "lg" })}>
        Open dashboard
      </Link>
    )
  }

  return (
    <>
      <Link href="/sign-in" className={buttonVariants({ size: "lg" })}>
        Sign in
      </Link>
      <Link
        href="/sign-up"
        className={buttonVariants({ variant: "outline", size: "lg" })}
      >
        Create account
      </Link>
    </>
  )
}

