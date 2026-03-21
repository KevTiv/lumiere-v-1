import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateAccountAccountParams, CreateAccountMoveParams, CreateAccountTaxParams, CreateCrossoveredBudgetParams } from "../generated/types";
import { getStdbConnection } from "../connection";

export type { CreateAccountAccountParams, CreateAccountMoveParams, CreateAccountTaxParams, CreateCrossoveredBudgetParams };

export function useCreateAccount(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateAccountAccountParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createAccountAccount({ organizationId, companyId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-accounts"] });
    },
  });
}

export function useCreateMove(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateAccountMoveParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createAccountMove({ organizationId, companyId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-moves"] });
    },
  });
}

export function usePostMove(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moveId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.postAccountMove({ organizationId, moveId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-moves"] });
    },
  });
}

export function useCancelMove(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moveId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.cancelAccountMove({ organizationId, moveId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-moves"] });
    },
  });
}

export function useCreateTax(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateAccountTaxParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createAccountTax({ organizationId, companyId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-taxes"] });
    },
  });
}

export function useCreateBudget(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateCrossoveredBudgetParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createCrossoveredBudget({ organizationId, companyId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}
