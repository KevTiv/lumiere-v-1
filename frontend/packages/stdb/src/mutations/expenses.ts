import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateExpenseParams, CreateExpenseSheetParams } from "../generated/types";
import { getStdbConnection } from "../connection";

export type { CreateExpenseParams, CreateExpenseSheetParams };

export function useCreateExpense(organizationId: bigint, companyId?: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateExpenseParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createExpense({
        organizationId,
        params: { ...params, companyId: params.companyId ?? companyId },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
  });
}

export function useCreateExpenseSheet(organizationId: bigint, companyId?: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateExpenseSheetParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createExpenseSheet({
        organizationId,
        params: { ...params, companyId: params.companyId ?? companyId },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenseSheets"] });
    },
  });
}
