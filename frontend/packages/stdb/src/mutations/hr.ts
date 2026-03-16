import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getStdbConnection } from "../connection";

export function useCreateEmployee(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Record<string, unknown>) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.createEmployee(organizationId, companyId, params as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-employees"] });
    },
  });
}

export function useCreateContract(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Record<string, unknown>) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.createContract(organizationId, companyId, params as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-contracts"] });
    },
  });
}

export function useCreateLeaveRequest(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Record<string, unknown>) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.createLeaveRequest(organizationId, companyId, params as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-leaves"] });
    },
  });
}

export function useApproveLeave(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (leaveId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.approveLeave(organizationId, leaveId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-leaves"] });
    },
  });
}

export function useRefuseLeave(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (leaveId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.refuseLeave(organizationId, leaveId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-leaves"] });
    },
  });
}

export function useCreatePayslip(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Record<string, unknown>) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      conn.reducers.createPayslip(organizationId, companyId, params as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-payslips"] });
    },
  });
}
