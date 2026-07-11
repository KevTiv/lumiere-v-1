import assert from 'node:assert'
import { describe, it } from 'node:test'

import type { FieldAccessContext } from '@lumiere/stdb/server'

import { DEFAULT_AI_PRIVACY_POLICY, resolveAiPrivacyPolicy } from './ai-privacy-policy'

function context(casbinRules: FieldAccessContext['casbinRules']): FieldAccessContext {
  return {
    organizationId: 7,
    roleId: 42,
    roleName: 'viewer',
    isSuperuser: false,
    rolePermissions: [],
    identityHex: '0x' + 'a'.repeat(64),
    casbinRules,
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

  it('ignores rules for other subjects or organizations', () => {
    const ctx = context([
      {
        ptype: 'p',
        v0: 'other-role',
        v1: '7',
        v2: 'ai:output:customer_phone',
        v3: 'read',
        v4: 'deny',
      },
      {
        ptype: 'p',
        v0: 'viewer',
        v1: '99',
        v2: 'ai:output:customer_phone',
        v3: 'read',
        v4: 'deny',
      },
    ])
    const policy = resolveAiPrivacyPolicy(ctx)
    assert.deepStrictEqual(policy.suppressedFields, [])
  })

  it('suppresses explicitly denied fields', () => {
    const ctx = context([
      {
        ptype: 'p',
        v0: 'viewer',
        v1: '7',
        v2: 'ai:output:api_token',
        v3: 'read',
        v4: 'deny',
      },
    ])
    const policy = resolveAiPrivacyPolicy(ctx)
    assert.deepStrictEqual(policy.suppressedFields, ['api_token'])
  })

  it('masks explicitly masked fields', () => {
    const ctx = context([
      {
        ptype: 'p',
        v0: 'viewer',
        v1: '7',
        v2: 'ai:output:customer_phone',
        v3: 'read',
        v4: 'mask',
      },
    ])
    const policy = resolveAiPrivacyPolicy(ctx)
    assert.deepStrictEqual(policy.maskedFields, ['customer_phone'])
  })

  it('parses field lists from metadata', () => {
    const ctx = context([
      {
        ptype: 'p',
        v0: 'viewer',
        v1: '7',
        v2: 'ai:output:*',
        v3: 'read',
        v4: 'deny',
        metadata: JSON.stringify({ fields: ['api_token', 'internal_note'] }),
      },
    ])
    const policy = resolveAiPrivacyPolicy(ctx)
    assert.deepStrictEqual(policy.suppressedFields, ['api_token', 'internal_note'])
  })

  it('parses field lists from v5', () => {
    const ctx = context([
      {
        ptype: 'p',
        v0: 'viewer',
        v1: '7',
        v2: 'ai:output:*',
        v3: 'read',
        v4: 'mask',
        v5: 'customer_phone, payment_reference',
      },
    ])
    const policy = resolveAiPrivacyPolicy(ctx)
    assert.deepStrictEqual(policy.maskedFields, ['customer_phone', 'payment_reference'])
  })

  it('normalizes field names', () => {
    const ctx = context([
      {
        ptype: 'p',
        v0: 'viewer',
        v1: '7',
        v2: 'ai:output:Customer-Phone',
        v3: 'read',
        v4: 'mask',
      },
    ])
    const policy = resolveAiPrivacyPolicy(ctx)
    assert.deepStrictEqual(policy.maskedFields, ['customerphone'])
  })

  it('ignores non-ai-output resources', () => {
    const ctx = context([
      {
        ptype: 'p',
        v0: 'viewer',
        v1: '7',
        v2: 'contact',
        v3: 'read',
        v4: 'deny',
        metadata: JSON.stringify({ fields: ['api_token'] }),
      },
    ])
    const policy = resolveAiPrivacyPolicy(ctx)
    assert.deepStrictEqual(policy.suppressedFields, [])
  })

  it('applies wildcard allow to category flags', () => {
    const ctx = context([
      {
        ptype: 'p',
        v0: 'viewer',
        v1: '7',
        v2: 'ai:output:*',
        v3: '*',
        v4: 'allow',
      },
    ])
    const policy = resolveAiPrivacyPolicy(ctx)
    assert.strictEqual(policy.maskPhoneFields, false)
    assert.strictEqual(policy.maskPaymentReferences, false)
    assert.strictEqual(policy.suppressSecrets, false)
  })
})
