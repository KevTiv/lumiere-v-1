import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getStdbConnection } from "../connection";

export function useCreatePurchaseOrder(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Record<string, unknown>) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.createPurchaseOrder(organizationId, companyId, params as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}

export function useConfirmPurchaseOrder(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.confirmPurchaseOrder(organizationId, orderId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}

export function useCancelPurchaseOrder(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.cancelPurchaseOrder(organizationId, orderId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}

export function useCreatePurchaseRequisition(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Record<string, unknown>) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.createPurchaseRequisition(organizationId, companyId, params as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-requisitions"] });
    },
  });
}
