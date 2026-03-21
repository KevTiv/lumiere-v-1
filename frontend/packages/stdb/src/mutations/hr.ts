import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateEmployeeParams,
  CreateContractParams,
  CreateLeaveRequestParams,
  CreatePayslipParams,
} from "../generated/types";
import { getStdbConnection } from "../connection";

export type { CreateEmployeeParams, CreateContractParams, CreateLeaveRequestParams, CreatePayslipParams };

export function useCreateEmployee(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateEmployeeParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createEmployee({ organizationId, companyId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-employees"] });
    },
  });
}

export function useCreateContract(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateContractParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createContract({ organizationId, companyId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-contracts"] });
    },
  });
}

export function useCreateLeaveRequest(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateLeaveRequestParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createLeaveRequest({ organizationId, companyId, params });
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
      return conn.reducers.approveLeave({ organizationId, leaveId });
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
      return conn.reducers.refuseLeave({ organizationId, leaveId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-leaves"] });
    },
  });
}

export function useCreatePayslip(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreatePayslipParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createPayslip({ organizationId, companyId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-payslips"] });
    },
  });
}
