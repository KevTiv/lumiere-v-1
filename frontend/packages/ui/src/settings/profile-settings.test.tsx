import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ProfileSettings } from './profile-settings'
import { i18n } from '@lumiere/i18n'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { save, profile } = vi.hoisted(() => ({
  save: vi.fn().mockResolvedValue(undefined),
  profile: { name: 'Old name', email: 'verified@example.test', firstName: 'Old', lastName: 'Name', timezone: 'UTC', language: 'en' },
}))
vi.mock('@lumiere/query-hooks/hooks/auth', () => ({
  useCurrentUserProfile: () => ({ data: profile, isLoading: false }),
  useUpdateUserProfile: () => ({ mutateAsync: save, isPending: false }),
}))
vi.mock('@lumiere/erp-session', () => ({ useErpSession: () => ({ organizationId: 7 }) }))
vi.mock('@/lib/rbac-context', () => ({ useRBAC: () => ({ currentUser: null }) }))
vi.mock('../components/theme-provider', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('@lumiere/i18n', async importOriginal => ({
  ...await importOriginal<typeof import('@lumiere/i18n')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))
afterEach(() => { document.body.innerHTML = ''; save.mockReset().mockResolvedValue(undefined); profile.language = 'en' })

it('lets a French-speaking user choose Kinyarwanda with French loanwords and applies nothing before save', async () => {
  profile.language = 'fr'
  await i18n.changeLanguage('fr')
  Element.prototype.scrollIntoView ??= vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(<ProfileSettings section="profile" />) })
  await act(async () => {
    host.querySelector('#profile-language')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(element => element.textContent === 'Kinyarwanda')!
  expect(option).toBeDefined()
  await act(async () => { option.click() })
  expect(host.querySelector<HTMLInputElement>('input[name="language"]')!.value).toBe('rw-x-fr')
  expect(i18n.language).toBe('fr')
  expect(save).not.toHaveBeenCalled()
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'rw-x-fr' }))
  await act(async () => root.unmount())
  await i18n.changeLanguage('en')
})

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
  expect(host.textContent).toContain('settings.profile.saveSuccess')
  await act(async () => root.unmount())
})

it('preserves both Kinyarwanda loanword preferences in the canonical profile language', async () => {
  for (const language of ['rw-x-fr', 'rw-x-en']) {
    profile.language = language
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ProfileSettings section="profile" />) })
    expect(host.querySelector('#profile-loanwords')).not.toBeNull()
    expect(host.querySelector<HTMLInputElement>('input[name="language"]')!.value).toBe(language)
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ language }))
    await act(async () => root.unmount())
    host.remove()
  }
})

it('uses English loanwords for Swahili without offering a French override', async () => {
  profile.language = 'sw'
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(<ProfileSettings section="profile" />) })
  expect(host.querySelector('#profile-loanwords')).toBeNull()
  expect(host.textContent).toContain('settings.profile.swahiliLoanwordsHint')
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'sw' }))
  await act(async () => root.unmount())
})

it('does not report a saved profile if the update fails', async () => {
  save.mockRejectedValueOnce(new Error('Unavailable'))
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(<ProfileSettings section="profile" />) })
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Unavailable')
  expect(host.textContent).not.toContain('settings.profile.saveSuccess')
  await act(async () => root.unmount())
})
