import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateMrpProductionParams,
  CreateBomParams,
  CreateWorkcenterParams,
} from "../generated/types";
import { getStdbConnection } from "../connection";

export type { CreateMrpProductionParams, CreateBomParams, CreateWorkcenterParams };

export function useCreateManufacturingOrder(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateMrpProductionParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      const scoped: CreateMrpProductionParams =
        params.companyId !== undefined ? params : { ...params, companyId };
      return conn.reducers.createManufacturingOrder({ organizationId, params: scoped });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mrp-productions"] });
    },
  });
}

export function useConfirmManufacturingOrder(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.confirmManufacturingOrder({ organizationId, moId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mrp-productions"] });
    },
  });
}

export function useStartManufacturingOrder(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.startManufacturingOrder({ organizationId, moId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mrp-productions"] });
    },
  });
}

export function useFinishManufacturingOrder(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.finishManufacturingOrder({ organizationId, moId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mrp-productions"] });
    },
  });
}

export function useCancelManufacturingOrder(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.cancelManufacturingOrder({ organizationId, moId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mrp-productions"] });
    },
  });
}

export function useCreateBom(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateBomParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      const scoped: CreateBomParams =
        params.companyId !== undefined ? params : { ...params, companyId };
      return conn.reducers.createBom({ organizationId, params: scoped });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mrp-boms"] });
      void queryClient.invalidateQueries({ queryKey: ["mrp-bom-lines"] });
    },
  });
}

export function useCreateWorkcenter(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateWorkcenterParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      const scoped: CreateWorkcenterParams =
        params.companyId !== undefined ? params : { ...params, companyId };
      return conn.reducers.createWorkcenter({ organizationId, params: scoped });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mrp-workcenters"] });
    },
  });
}
