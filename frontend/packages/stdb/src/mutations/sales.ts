import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateSaleOrderParams, CreatePricelistParams } from "../generated/types";
import { getStdbConnection } from "../connection";

export type { CreateSaleOrderParams, CreatePricelistParams };

export function useCreateSaleOrder(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateSaleOrderParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.createSaleOrder(organizationId, companyId, params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sale-orders"] });
    },
  });
}

export function useConfirmSaleOrder(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.confirmSalesOrder(organizationId, orderId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sale-orders"] });
    },
  });
}

export function useCancelSaleOrder(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.cancelSaleOrder(organizationId, orderId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sale-orders"] });
    },
  });
}

export function useCreatePricelist(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreatePricelistParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.createPricelist(organizationId, params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pricelists"] });
    },
  });
}
