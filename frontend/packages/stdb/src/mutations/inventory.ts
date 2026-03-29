import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateProductParams,
  CreateStockPickingParams,
  CreateWarehouseParams,
  CreateInventoryAdjustmentParams,
  UpdateProductParams,
  CreateProductVariantParams,
  UpdateWarehouseParams,
  AssignUserToPickingParams,
} from "../generated/types";
import { getStdbConnection } from "../connection";

export type {
  CreateProductParams,
  CreateStockPickingParams,
  CreateWarehouseParams,
  CreateInventoryAdjustmentParams,
  UpdateProductParams,
  CreateProductVariantParams,
  UpdateWarehouseParams,
  AssignUserToPickingParams,
};

export function useCreateProduct(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateProductParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createProduct({ organizationId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useCreateStockPicking(organizationId: bigint, companyId?: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateStockPickingParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createStockPicking({
        organizationId,
        params: { ...params, companyId: params.companyId ?? companyId },
      });
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
      return conn.reducers.createWarehouse({ organizationId, companyId, params });
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
      return conn.reducers.createInventoryAdjustment({ organizationId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-adjustments"] });
    },
  });
}

export function useUpdateProduct(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { productId: bigint; params: UpdateProductParams }) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.updateProduct({
        organizationId,
        productId: args.productId,
        params: args.params,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useCreateProductVariant(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { productTmplId: bigint; params: CreateProductVariantParams }) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createProductVariant({
        organizationId,
        productTmplId: args.productTmplId,
        params: args.params,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useUpdateWarehouse(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { warehouseId: bigint; params: UpdateWarehouseParams }) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.updateWarehouse({
        organizationId,
        companyId,
        warehouseId: args.warehouseId,
        params: args.params,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
    },
  });
}

export function useAssignUserToPicking(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { pickingId: bigint; params: AssignUserToPickingParams }) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.assignUserToPicking({
        organizationId,
        pickingId: args.pickingId,
        params: args.params,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-pickings"] });
    },
  });
}
