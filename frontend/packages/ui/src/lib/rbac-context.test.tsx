import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RBACProvider, useRBAC } from './rbac-context'
import { mapBackendRolesToRoles } from './rbac-defaults'
import type { PolicyRule, User } from './rbac-types'

const user: User = { id: 'actor', name: '', email: '', roles: ['7'], status: 'active', department: '', lastLogin: '', createdAt: '', updatedAt: '' }
function Probe() {
  const { checkPermission } = useRBAC()
  return <span>{String(checkPermission('admin:users', 'update').allowed)}:{String(checkPermission('admin:users', 'create').allowed)}</span>
}
function permissions(name: string, grants: string[], policies: PolicyRule[] = []) {
  return renderToStaticMarkup(<RBACProvider initialUser={user} initialRoles={mapBackendRolesToRoles([{ id: '7', name, isActive: true, permissions: grants }])} initialPolicies={policies}><Probe /></RBACProvider>)
}
describe('permission enforcement in rendered controls', () => {
  it('never grants access based on an administrator role name', () => {
    expect(permissions('Admin', [])).toContain('false:false')
  })
  it('keeps create separate from update', () => {
    expect(permissions('Editor', ['user_organization:write'])).toContain('true:false')
  })
  it('applies a canonical resource deny before a wildcard role', () => {
    expect(permissions('Owner', ['*:*'], [{ id: 'deny', subject: 'actor', resource: 'user_organization', action: 'write', effect: 'deny' }])).toContain('false:true')
  })
  it('does not restore revoked permissions from display metadata', () => {
    const [role] = mapBackendRolesToRoles([{ id: '7', name: 'Empty', isActive: true, permissions: [], metadata: JSON.stringify({ uiPermissions: ['*:*'] }) }])
    expect(role.permissions).toEqual([])
  })
})
