"use client"

import { useMemo } from "react"

import {
  mapOrgPermissionRowsToPolicyRules,
} from "@lumiere/ui"
import type { PolicyRule } from "@lumiere/ui"
import { useStdbQuery, useStdbReducer } from "@lumiere/query-hooks/hooks/stdb"
import type { QueryRowFor } from "@lumiere/stdb/query-row-map"

function readVersionHash(
  row: QueryRowFor<"policy-snapshots"> | undefined,
): string | undefined {
  if (!row) return undefined
  const hash = row.versionHash
  return typeof hash === "string" && hash.length > 0 ? hash : undefined
}

/**
 * Unified org permission snapshot for the current user.
 * Subscribes to org-permissions + cached policy_snapshot (server auto-refreshes snapshots).
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
  } = useStdbQuery("policy-snapshots", orgKey, { enabled })

  const refreshSnapshot = useStdbReducer("refresh_policy_snapshot")

  const orgPolicyRules = useMemo<PolicyRule[]>(() => {
    return mapOrgPermissionRowsToPolicyRules(orgPermissions)
  }, [orgPermissions])

  const snapshot = snapshots[0]
  const versionHash = readVersionHash(snapshot)

  return {
    orgPolicyRules,
    snapshot,
    versionHash,
    isLoading: orgPermsLoading || snapshotLoading,
    refreshSnapshot: () => refreshSnapshot.mutate({}),
  }
}
