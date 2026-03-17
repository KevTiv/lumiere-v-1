import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getStdbConnection } from "../connection";
import { useStdbConnection } from "../context";
import {
  queryUserProfile,
  queryCasbinRules,
  queryStdbRoles,
  queryUserRoleAssignments,
  queryUserOrganization,
  type UserProfile,
  type CasbinRule,
  type StdbRole,
  type UserRoleAssignment,
  type UserOrganization,
} from "../queries/auth";

export type {
  UserProfile,
  CasbinRule,
  StdbRole,
  UserRoleAssignment,
  UserOrganization,
};

export function useUserProfile(initialData?: Record<string, unknown>): UserProfile | null {
  const { identity, connected } = useStdbConnection();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["user-profile", identity], [identity]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn || !identity) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.user_profile.onInsert((_ctx, _row) => reload());
    conn.db.user_profile.onUpdate((_ctx, _old, _new) => reload());
    conn.db.user_profile.onDelete((_ctx, _row) => reload());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, connected, queryClient]);

  const { data } = useQuery({
    queryKey,
    queryFn: () => queryUserProfile(identity!),
    staleTime: Infinity,
    enabled: !!identity && connected,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData ? 0 : undefined,
  });

  return data ?? null;
}

export function useCasbinRules(initialData?: Record<string, unknown>[]): CasbinRule[] {
  const { identity, connected } = useStdbConnection();
  const queryClient = useQueryClient();
  // Include identity in key to prevent cross-user cache contamination
  const queryKey = useMemo(() => ["casbin-rules", identity ?? ""], [identity]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn || !identity) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.casbin_rule.onInsert((_ctx, _row) => reload());
    conn.db.casbin_rule.onUpdate((_ctx, _old, _new) => reload());
    conn.db.casbin_rule.onDelete((_ctx, _row) => reload());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, connected, queryClient]);

  const { data } = useQuery({
    queryKey,
    queryFn: queryCasbinRules,
    staleTime: Infinity,
    enabled: !!identity && connected,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });

  return data ?? [];
}

export function useStdbRoles(initialData?: Record<string, unknown>[]): StdbRole[] {
  const { identity, connected } = useStdbConnection();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["stdb-roles"], []);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn || !identity) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.role.onInsert((_ctx, _row) => reload());
    conn.db.role.onUpdate((_ctx, _old, _new) => reload());
    conn.db.role.onDelete((_ctx, _row) => reload());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, connected, queryClient]);

  const { data } = useQuery({
    queryKey,
    queryFn: queryStdbRoles,
    staleTime: Infinity,
    enabled: !!identity && connected,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });

  return data ?? [];
}

export function useUserRoleAssignments(initialData?: Record<string, unknown>[]): UserRoleAssignment[] {
  const { identity, connected } = useStdbConnection();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["user-role-assignments", identity], [identity]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn || !identity) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.user_role_assignment.onInsert((_ctx, _row) => reload());
    conn.db.user_role_assignment.onUpdate((_ctx, _old, _new) => reload());
    conn.db.user_role_assignment.onDelete((_ctx, _row) => reload());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, connected, queryClient]);

  const { data } = useQuery({
    queryKey,
    queryFn: () => queryUserRoleAssignments(identity!),
    staleTime: Infinity,
    enabled: !!identity && connected,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });

  return data ?? [];
}

export function useUserOrganization(initialData?: Record<string, unknown>): UserOrganization | null {
  const { identity, connected } = useStdbConnection();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["user-organization", identity], [identity]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn || !identity) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.user_organization.onInsert((_ctx, _row) => reload());
    conn.db.user_organization.onUpdate((_ctx, _old, _new) => reload());
    conn.db.user_organization.onDelete((_ctx, _row) => reload());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, connected, queryClient]);

  const { data } = useQuery({
    queryKey,
    queryFn: () => queryUserOrganization(identity!),
    staleTime: Infinity,
    enabled: !!identity && connected,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData ? 0 : undefined,
  });

  return data ?? null;
}
