'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { phCapture } from '@/lib/posthog-browser'

/**
 * SPA `$pageview` events (automatic pageviews are disabled in `instrumentation-client.ts`).
 */
export function PostHogPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!pathname) return
    const qs = searchParams?.toString()
    const url = qs ? `${window.origin}${pathname}?${qs}` : `${window.origin}${pathname}`
    phCapture('$pageview', { $current_url: url })
  }, [pathname, searchParams])

  return null
}
