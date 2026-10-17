import assert from 'node:assert/strict'
import test from 'node:test'
import { requiresPrivatePageLogin } from './private-release-policy.ts'

test('anonymous production traffic cannot render ERP, onboarding or signup pages', () => {
  for (const path of ['/', '/overview', '/crm', '/accounting', '/onboarding', '/sign-up', '/sign-in-not-real']) {
    assert.equal(requiresPrivatePageLogin(path, true, false), true, path)
  }
})

test('public authentication and static resources remain reachable', () => {
  for (const path of ['/sign-in', '/forgot-password', '/reset-password', '/accept-invite', '/auth/invite/prepare', '/auth/callback',
    '/api/health', '/api/auth/signin', '/_next/static/chunk.js', '/robots.txt', '/favicon.ico']) {
    assert.equal(requiresPrivatePageLogin(path, true, false), false, path)
  }
})

test('session-bearing requests still reach real session authorization; dev is unchanged', () => {
  assert.equal(requiresPrivatePageLogin('/overview', true, true), false)
  assert.equal(requiresPrivatePageLogin('/overview', false, false), false)
})
