import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getStdbConnection } from "../connection";

export function useCreateManufacturingOrder(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Record<string, unknown>) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.createManufacturingOrder(organizationId, companyId, params as never);
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
      conn.reducers.confirmManufacturingOrder(organizationId, companyId, moId);
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
      conn.reducers.startManufacturingOrder(organizationId, companyId, moId);
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
      conn.reducers.finishManufacturingOrder(organizationId, companyId, moId);
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
      conn.reducers.cancelManufacturingOrder(organizationId, companyId, moId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mrp-productions"] });
    },
  });
}

export function useCreateBom(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Record<string, unknown>) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.createBom(organizationId, companyId, params as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mrp-boms"] });
    },
  });
}

export function useCreateWorkcenter(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Record<string, unknown>) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.createWorkcenter(organizationId, companyId, params as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mrp-workcenters"] });
    },
  });
}
