import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateExpenseParams, CreateExpenseSheetParams } from "../generated/types";
import { getStdbConnection } from "../connection";

export type { CreateExpenseParams, CreateExpenseSheetParams };

export function useCreateExpense(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateExpenseParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createExpense({ organizationId, companyId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
  });
}

export function useCreateExpenseSheet(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateExpenseSheetParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createExpenseSheet({ organizationId, companyId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenseSheets"] });
    },
  });
}
