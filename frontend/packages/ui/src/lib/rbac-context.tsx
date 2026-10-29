"use client"

import { i18n as uiI18n, useTranslation } from "@lumiere/i18n"

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react"
import type { 
  User, 
  Role, 
  PolicyRule, 
  Resource, 
  Action, 
  PermissionCheckResult,
  RBACContext as RBACContextType 
} from "./rbac-types"
import {
  defaultRoles,
  defaultUsers,
  defaultPolicies,
  actionsMatch,
  resourcesMatch,
  roleHasWildcardPermission,
} from "./rbac-defaults"

const RBACContext = createContext<RBACContextType | null>(null)

interface RBACProviderProps {
  children: React.ReactNode
  initialUser?: User | null
  initialRoles?: Role[]
  initialPolicies?: PolicyRule[]
  /** Seed demo users/roles when props are omitted (storybook/dev only). Default false. */
  useDefaultFixtures?: boolean
  /** Set false while roles/policies are loading from the backend. Defaults to true. */
  permissionsReady?: boolean
}

export function RBACProvider({
  children,
  initialUser,
  initialRoles,
  initialPolicies,
  useDefaultFixtures = false,
  permissionsReady = true,
}: RBACProviderProps) {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    if (initialUser !== undefined) return initialUser
    if (!useDefaultFixtures) return null
    return defaultUsers.find((u) => u.id === "user-1") ?? null
  })
  const [roles, setRoles] = useState<Role[]>(() => {
    if (initialRoles !== undefined) return initialRoles
    return useDefaultFixtures ? defaultRoles : []
  })
  const [policies, setPolicies] = useState<PolicyRule[]>(() => {
    if (initialPolicies !== undefined) return initialPolicies
    return useDefaultFixtures ? defaultPolicies : []
  })

  useEffect(() => {
    if (initialUser !== undefined) setCurrentUser(initialUser)
  }, [initialUser])

  useEffect(() => {
    if (initialRoles !== undefined) setRoles(initialRoles)
  }, [initialRoles])

  useEffect(() => {
    if (initialPolicies !== undefined) setPolicies(initialPolicies)
  }, [initialPolicies])

  const activeRoles = useMemo(
    () => roles.filter((role) => role.isActive !== false),
    [roles],
  )

  const getUserPolicies = useCallback((user: User | null): PolicyRule[] => {
    if (!user) return []
    
    const userRoles = activeRoles.filter((r) => user.roles.includes(r.id))
    const rolePolicies = userRoles.flatMap((r) => r.permissions)
    
    // Policies can target the user directly or any effective role assigned to
    // the user (including supplemental role assignments).
    const directPolicies = policies.filter(
      (p) => p.subject === user.id || user.roles.includes(p.subject),
    )
    
    return [...rolePolicies, ...directPolicies]
  }, [activeRoles, policies])

  // Casbin-style permission check
  const checkPermission = useCallback((
    resource: Resource, 
    action: Action
  ): PermissionCheckResult => {
    if (!currentUser) {
      return { allowed: false, get reason() { return uiI18n.t("common.builtIn.rbacContext.checkPermission.reason", { defaultValue: "No user logged in" }) } }
    }

    if (currentUser.isSuperuser) return { allowed: true, get reason() { return uiI18n.t("common.builtIn.rbacContext.checkPermission.reasonplatformSuperuser", { defaultValue: "Platform superuser" }) } }

    const applicablePolicies = getUserPolicies(currentUser)
    
    // Sort policies: deny rules first, then by specificity
    const sortedPolicies = [...applicablePolicies].sort((a, b) => {
      // Deny rules take precedence
      if (a.effect === "deny" && b.effect !== "deny") return -1
      if (b.effect === "deny" && a.effect !== "deny") return 1
      
      // More specific rules take precedence
      const aSpecificity = (a.resource === "*" ? 0 : 1) + (a.action === "*" ? 0 : 1)
      const bSpecificity = (b.resource === "*" ? 0 : 1) + (b.action === "*" ? 0 : 1)
      return bSpecificity - aSpecificity
    })

    // Find matching rule
    for (const rule of sortedPolicies) {
      const resourceMatch = resourcesMatch(rule.resource, resource)
      const actionMatch = actionsMatch(rule.action, action)
      
      if (resourceMatch && actionMatch) {
        return {
          allowed: rule.effect === "allow",
          rule,
          reason: rule.effect === "allow" 
            ? uiI18n.t("common.permissions.allowedByPolicy", { defaultValue: "Allowed by policy: {{id}}", id: rule.id })
            : uiI18n.t("common.permissions.deniedByPolicy", { defaultValue: "Denied by policy: {{id}}", id: rule.id })
        }
      }
    }

    // Default deny
    return { allowed: false, get reason() { return uiI18n.t("common.builtIn.rbacContext.checkPermission.reasonnoMatchingPolicyFound", { defaultValue: "No matching policy found" }) } }
  }, [currentUser, getUserPolicies])

  // Check if user has a specific role
  const hasRole = useCallback((roleId: string): boolean => {
    if (!currentUser) return false
    return currentUser.roles.includes(roleId)
  }, [currentUser])

  const isAdmin = useCallback((): boolean => {
    if (!currentUser) return false

    const userRoles = activeRoles.filter((role) => currentUser.roles.includes(role.id))

    if (currentUser.isSuperuser) return true
    if (userRoles.some((role) => roleHasWildcardPermission(role))) return true

    return false
  }, [currentUser, activeRoles])

  const contextValue = useMemo<RBACContextType>(() => ({
    currentUser,
    roles,
    policies,
    checkPermission,
    hasRole,
    isAdmin,
    permissionsReady,
  }), [currentUser, roles, policies, checkPermission, hasRole, isAdmin, permissionsReady])

  // Expose setters for admin components
  const extendedContext = useMemo(() => ({
    ...contextValue,
    setCurrentUser,
    setRoles,
    setPolicies,
    allUsers: defaultUsers,
  }), [contextValue])

  return (
    <RBACContext.Provider value={extendedContext as RBACContextType}>
      {children}
    </RBACContext.Provider>
  )
}

export function useRBAC(): RBACContextType & {
  setCurrentUser: (user: User | null) => void
  setRoles: React.Dispatch<React.SetStateAction<Role[]>>
  setPolicies: React.Dispatch<React.SetStateAction<PolicyRule[]>>
  allUsers: User[]
} {
  const context = useContext(RBACContext)
  if (!context) {
    throw new Error("useRBAC must be used within an RBACProvider")
  }
  return context as RBACContextType & {
    setCurrentUser: (user: User | null) => void
    setRoles: React.Dispatch<React.SetStateAction<Role[]>>
    setPolicies: React.Dispatch<React.SetStateAction<PolicyRule[]>>
    allUsers: User[]
  }
}

// HOC for protecting components
export function withPermission<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  resource: Resource,
  action: Action
) {
  return function ProtectedComponent(props: P) {
    const { t } = useTranslation()
    const { checkPermission } = useRBAC()
    const result = checkPermission(resource, action)
    
    if (!result.allowed) {
      return (
        <div className="p-8 text-center text-muted-foreground">
          <p>{t("common.permissions.accessDenied", { defaultValue: "You don't have permission to access this resource." })}</p>
          <p className="text-sm mt-2">{result.reason}</p>
        </div>
      )
    }
    
    return <WrappedComponent {...props} />
  }
}

// Hook for checking permissions
export function usePermission(resource: Resource, action: Action): PermissionCheckResult {
  const { checkPermission } = useRBAC()
  return checkPermission(resource, action)
}

// Hook for filtering resources by permission
export function useFilteredResources<T extends { resource: Resource }>(
  items: T[],
  action: Action
): T[] {
  const { checkPermission } = useRBAC()
  return items.filter(item => checkPermission(item.resource, action).allowed)
}
