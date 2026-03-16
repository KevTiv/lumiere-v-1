import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateProductParams,
  CreateStockPickingParams,
  CreateWarehouseParams,
  CreateInventoryAdjustmentParams,
} from "../generated/types";
import { getStdbConnection } from "../connection";

export type {
  CreateProductParams,
  CreateStockPickingParams,
  CreateWarehouseParams,
  CreateInventoryAdjustmentParams,
};

export function useCreateProduct(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateProductParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.createProduct(organizationId, params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useCreateStockPicking(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateStockPickingParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.createStockPicking(organizationId, companyId, params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-pickings"] });
    },
  });
}

export function useCreateWarehouse(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateWarehouseParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.createWarehouse(organizationId, companyId, params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
    },
  });
}

export function useCreateInventoryAdjustment(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateInventoryAdjustmentParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.createInventoryAdjustment(organizationId, params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-adjustments"] });
    },
  });
}
