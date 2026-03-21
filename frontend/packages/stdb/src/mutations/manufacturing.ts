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
      return conn.reducers.createManufacturingOrder({ organizationId, companyId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mrp-productions"] });
    },
  });
}

export function useConfirmManufacturingOrder(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.confirmManufacturingOrder({ organizationId, companyId, moId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mrp-productions"] });
    },
  });
}

export function useStartManufacturingOrder(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.startManufacturingOrder({ organizationId, companyId, moId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mrp-productions"] });
    },
  });
}

export function useFinishManufacturingOrder(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.finishManufacturingOrder({ organizationId, companyId, moId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mrp-productions"] });
    },
  });
}

export function useCancelManufacturingOrder(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.cancelManufacturingOrder({ organizationId, companyId, moId });
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
      return conn.reducers.createBom({ organizationId, companyId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mrp-boms"] });
    },
  });
}

export function useCreateWorkcenter(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateWorkcenterParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createWorkcenter({ organizationId, companyId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mrp-workcenters"] });
    },
  });
}
