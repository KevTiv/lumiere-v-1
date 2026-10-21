import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ProfileSettings } from './profile-settings'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { save } = vi.hoisted(() => ({ save: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@lumiere/query-hooks/hooks/auth', () => ({
  useCurrentUserProfile: () => ({ data: { name: 'Old name', email: 'verified@example.test', firstName: 'Old', lastName: 'Name', timezone: 'UTC', language: 'en' }, isLoading: false }),
  useUpdateUserProfile: () => ({ mutateAsync: save, isPending: false }),
}))
vi.mock('@lumiere/erp-session', () => ({ useErpSession: () => ({ organizationId: 7 }) }))
vi.mock('@/lib/rbac-context', () => ({ useRBAC: () => ({ currentUser: null }) }))
vi.mock('../components/theme-provider', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('@lumiere/i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(() => { document.body.innerHTML = ''; save.mockClear() })

it('saves editable profile fields without submitting the verified identity email', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(<ProfileSettings section="profile" />) })
  const name = host.querySelector<HTMLInputElement>('#profile-name')!
  name.value = 'New display name'
  expect(host.querySelector<HTMLInputElement>('#profile-email')!.readOnly).toBe(true)
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(save).toHaveBeenCalledWith({ name: 'New display name', firstName: 'Old', lastName: 'Name', timezone: 'UTC', language: 'en' })
  expect(host.textContent).toContain('Your profile has been saved.')
  await act(async () => root.unmount())
})
