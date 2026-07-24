import assert from 'node:assert'
import { describe, it } from 'node:test'

import type { FieldAccessContext } from '@lumiere/stdb/server'

import { DEFAULT_AI_PRIVACY_POLICY, resolveAiPrivacyPolicy } from './ai-privacy-policy'

function context(fieldPermissions: FieldAccessContext['fieldPermissions']): FieldAccessContext {
  return {
    organizationId: 7,
    roleId: 42,
    roleName: 'viewer',
    isSuperuser: false,
    rolePermissions: [],
    identityHex: '0x' + 'a'.repeat(64),
    fieldPermissions,
  }
}

describe('resolveAiPrivacyPolicy', () => {
  it('returns defaults when fieldAccess is undefined', () => {
    assert.deepStrictEqual(resolveAiPrivacyPolicy(undefined), DEFAULT_AI_PRIVACY_POLICY)
  })

  it('returns defaults for superusers', () => {
    const ctx: FieldAccessContext = {
      ...context([]),
      isSuperuser: true,
    }
    assert.deepStrictEqual(resolveAiPrivacyPolicy(ctx), DEFAULT_AI_PRIVACY_POLICY)
  })

  it('ignores rules for other subjects', () => {
    const ctx = context([
      {
        resource: 'ai:output:customer_phone',
        action: 'read',
        subjectRoleId: 99,
        allowedFields: ['customer_phone'],
      },
    ])
    const policy = resolveAiPrivacyPolicy(ctx)
    assert.deepStrictEqual(policy.suppressedFields, [])
  })

  it('suppresses ai:output fields for matching subject', () => {
    const ctx = context([
      {
        resource: 'ai:output:api_token',
        action: 'read',
        subjectRoleId: 42,
        allowedFields: ['api_token'],
      },
    ])
    const policy = resolveAiPrivacyPolicy(ctx)
    assert.deepStrictEqual(policy.suppressedFields, ['api_token'])
  })

  it('ignores non-ai-output resources', () => {
    const ctx = context([
      {
        resource: 'contact',
        action: 'read',
        subjectRoleId: 42,
        allowedFields: ['api_token'],
      },
    ])
    const policy = resolveAiPrivacyPolicy(ctx)
    assert.deepStrictEqual(policy.suppressedFields, [])
  })
})
