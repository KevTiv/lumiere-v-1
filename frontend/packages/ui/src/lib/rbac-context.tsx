"use client"

import React, { createContext, useContext, useState, useCallback, useMemo } from "react"
import type { 
  User, 
  Role, 
  PolicyRule, 
  Resource, 
  Action, 
  PermissionCheckResult,
  RBACContext as RBACContextType 
} from "./rbac-types"
import { defaultRoles, defaultUsers, defaultPolicies } from "./rbac-defaults"

const RBACContext = createContext<RBACContextType | null>(null)

interface RBACProviderProps {
  children: React.ReactNode
  initialUser?: User | null
  initialRoles?: Role[]
  initialPolicies?: PolicyRule[]
}

export function RBACProvider({ children, initialUser, initialRoles, initialPolicies }: RBACProviderProps) {
  const [currentUser, setCurrentUser] = useState<User | null>(
    initialUser ?? defaultUsers.find(u => u.id === "user-1") ?? null
  )
  const [roles, setRoles] = useState<Role[]>(initialRoles ?? defaultRoles)
  const [policies, setPolicies] = useState<PolicyRule[]>(initialPolicies ?? defaultPolicies)

  // Get all policies applicable to the current user
  const getUserPolicies = useCallback((user: User | null): PolicyRule[] => {
    if (!user) return []
    
    const userRoles = roles.filter(r => user.roles.includes(r.id))
    const rolePolicies = userRoles.flatMap(r => r.permissions)
    
    // Also get direct user policies
    const directPolicies = policies.filter(p => p.subject === user.id)
    
    return [...rolePolicies, ...directPolicies]
  }, [roles, policies])

  // Casbin-style permission check
  const checkPermission = useCallback((
    resource: Resource, 
    action: Action
  ): PermissionCheckResult => {
    if (!currentUser) {
      return { allowed: false, reason: "No user logged in" }
    }

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
      const resourceMatch = rule.resource === "*" || rule.resource === resource
      const actionMatch = rule.action === "*" || rule.action === action
      
      if (resourceMatch && actionMatch) {
        return {
          allowed: rule.effect === "allow",
          rule,
          reason: rule.effect === "allow" 
            ? `Allowed by policy: ${rule.id}` 
            : `Denied by policy: ${rule.id}`
        }
      }
    }

    // Default deny
    return { allowed: false, reason: "No matching policy found" }
  }, [currentUser, getUserPolicies])

  // Check if user has a specific role
  const hasRole = useCallback((roleId: string): boolean => {
    if (!currentUser) return false
    return currentUser.roles.includes(roleId)
  }, [currentUser])

  // Check if user is an admin
  const isAdmin = useCallback((): boolean => {
    return hasRole("role-admin")
  }, [hasRole])

  const contextValue = useMemo<RBACContextType>(() => ({
    currentUser,
    roles,
    policies,
    checkPermission,
    hasRole,
    isAdmin,
  }), [currentUser, roles, policies, checkPermission, hasRole, isAdmin])

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
    const { checkPermission } = useRBAC()
    const result = checkPermission(resource, action)
    
    if (!result.allowed) {
      return (
        <div className="p-8 text-center text-muted-foreground">
          <p>You don&apos;t have permission to access this resource.</p>
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
