import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreatePurchaseOrderParams, CreatePurchaseRequisitionParams } from "../generated/types";
import { getStdbConnection } from "../connection";

export type { CreatePurchaseOrderParams, CreatePurchaseRequisitionParams };

export function useCreatePurchaseOrder(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreatePurchaseOrderParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createPurchaseOrder({ organizationId, companyId, params });
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
      return conn.reducers.confirmPurchaseOrder({ organizationId, orderId });
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
      return conn.reducers.cancelPurchaseOrder({ organizationId, orderId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}

export function useCreatePurchaseRequisition(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreatePurchaseRequisitionParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createPurchaseRequisition({ organizationId, companyId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-requisitions"] });
    },
  });
}
