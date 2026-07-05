"use client"

import { useEffect, useMemo } from "react"

import {
  mapOrgPermissionRowsToPolicyRules,
  type BackendOrgPermissionRow,
} from "@lumiere/ui"
import type { PolicyRule } from "@lumiere/ui"
import { useStdbQuery, useStdbReducer } from "@lumiere/query-hooks/hooks/stdb"

export interface PolicySnapshotRow {
  id?: number | string
  organizationId?: number
  organization_id?: number
  userIdentity?: string
  user_identity?: string
  roleId?: number
  role_id?: number
  roleName?: string
  role_name?: string
  rolePermissions?: string[]
  role_permissions?: string[]
  orgPermissionGrants?: unknown[]
  org_permission_grants?: unknown[]
  fieldPermissions?: unknown[]
  field_permissions?: unknown[]
  isSuperuser?: boolean
  is_superuser?: boolean
  versionHash?: string
  version_hash?: string
  refreshedAt?: unknown
  refreshed_at?: unknown
}

function readVersionHash(row: PolicySnapshotRow | undefined): string | undefined {
  if (!row) return undefined
  const hash = row.versionHash ?? row.version_hash
  return typeof hash === "string" && hash.length > 0 ? hash : undefined
}

/**
 * Unified org permission snapshot for the current user.
 * Loads org-permissions + cached policy_snapshot; refreshes snapshot on mount.
 */
export function usePolicySnapshot(
  organizationId?: number,
  identityHex?: string,
) {
  const orgKey = organizationId ?? 0
  const enabled =
    organizationId != null &&
    organizationId > 0 &&
    Boolean(identityHex && identityHex !== "unknown")

  const { data: orgPermissions = [], isLoading: orgPermsLoading } = useStdbQuery(
    "org-permissions",
    orgKey,
    { enabled },
  )

  const {
    data: snapshots = [],
    isLoading: snapshotLoading,
    refetch: refetchSnapshot,
  } = useStdbQuery("policy-snapshots", orgKey, { enabled })

  const refreshSnapshot = useStdbReducer("refresh_policy_snapshot")

  useEffect(() => {
    if (!enabled || refreshSnapshot.isPending) return
    refreshSnapshot.mutate([organizationId], {
      onSuccess: () => {
        void refetchSnapshot()
      },
    })
    // Refresh once per org/identity session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, organizationId, identityHex])

  const orgPolicyRules = useMemo<PolicyRule[]>(() => {
    return mapOrgPermissionRowsToPolicyRules(orgPermissions as BackendOrgPermissionRow[])
  }, [orgPermissions])

  const snapshot = (snapshots[0] ?? undefined) as PolicySnapshotRow | undefined
  const versionHash = readVersionHash(snapshot)

  return {
    orgPolicyRules,
    snapshot,
    versionHash,
    isLoading: orgPermsLoading || snapshotLoading || refreshSnapshot.isPending,
    refreshSnapshot: () => refreshSnapshot.mutate([organizationId]),
  }
}
