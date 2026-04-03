'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useCallback } from 'react'

/**
 * Synchronises the active module tab with the URL's `?tab=` search param.
 * Falls back to defaultTab if the param is absent or not in validTabs.
 *
 * Uses router.replace (not push) so tab changes don't pollute history —
 * the Back button exits the module rather than cycling through tabs.
 *
 * @example
 *   const { activeTab, setActiveTab } = useModuleTab(
 *     config.defaultTab ?? 'dashboard',
 *     config.tabs.map(t => t.id),
 *   )
 */
export function useModuleTab(defaultTab: string, validTabs: string[]) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const rawTab = searchParams.get('tab')
  const activeTab = rawTab && validTabs.includes(rawTab) ? rawTab : defaultTab

  const setActiveTab = useCallback(
    (tab: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (tab === defaultTab) {
        params.delete('tab')
      } else {
        params.set('tab', tab)
      }
      const qs = params.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
    },
    [searchParams, router, pathname, defaultTab],
  )

  return { activeTab, setActiveTab }
}
