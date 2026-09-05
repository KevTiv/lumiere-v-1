"use client"

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../../http"
import type {
  CreateLeaveRequestParams,
  CreateLeaveTypeParams,
  HrLeave,
  HrLeaveType,
  UpdateLeaveTypeParams,
} from "@lumiere/stdb/types"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { scalarToU64 as toScalarU64, type ScalarId } from "@lumiere/erp-shared/u64"
import {
  finalizeCreateLeaveRequestParams,
  finalizeUpdateLeaveTypeParams,
} from "../hr-params-merge"


export function useLeaveRequests(
  organizationId: bigint,
  initialData?: HrLeave[],
) {
  return useQuery<HrLeave[]>({
    queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/leave-requests', 'Failed to fetch leave requests'),
    staleTime: 30_000,
    initialData,
  })
}

/** Bounded queue: leave requests awaiting approval (Confirm | ValidatedOne). */
export function useLeavesToApprove(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-leaves-to-approve', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/leaves-to-approve', 'Failed to fetch leaves to approve'),
    staleTime: 15_000,
    initialData,
  })
}


export function useLeaveTypes(
  organizationId: bigint,
  initialData?: HrLeaveType[],
) {
  return useQuery<HrLeaveType[]>({
    queryKey: ['hr-leave-types', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/leave-types', 'Failed to fetch leave types'),
    staleTime: 30_000,
    initialData,
  })
}


export function useCreateLeaveRequest(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateLeaveRequestParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateLeaveRequestParams(params)
      const { urlPath, init } = stdbBffCommandPost("create_leave_request", { companyId: companyId, params: stdbParamsToJson(finalized) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create leave request')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] }),
  })
}


export function useCreateLeaveType(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateLeaveTypeParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_leave_type", { companyId: companyId, params: stdbParamsToJson(params, "CreateLeaveTypeParams") })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create leave type')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-leave-types', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateLeaveType(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { leaveTypeId: ScalarId; params: Partial<UpdateLeaveTypeParams> }>({
    mutationFn: async ({ leaveTypeId, params }) => {
      const { urlPath, init } = stdbBffCommandPost("update_leave_type", { companyId: companyId, leaveTypeId: toScalarU64(leaveTypeId), params: stdbParamsToJson(finalizeUpdateLeaveTypeParams(params)) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update leave type')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-leave-types', rqBigIntKey(organizationId)] }),
  })
}

export function useSubmitLeave(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (leaveId) => {
      const { urlPath, init } = stdbBffCommandPost("submit_leave", { companyId: companyId, leaveId: toScalarU64(leaveId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to submit leave')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] })
    },
  })
}

export function useApproveLeave(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (leaveId) => {
      const { urlPath, init } = stdbBffCommandPost("approve_leave", { companyId: companyId, leaveId: toScalarU64(leaveId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to approve leave')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] })
    },
  })
}

export function useRefuseLeave(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (leaveId) => {
      const { urlPath, init } = stdbBffCommandPost("refuse_leave", { companyId: companyId, leaveId: toScalarU64(leaveId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to refuse leave')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] })
    },
  })
}

export function useResetLeaveToDraft(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (leaveId) => {
      const { urlPath, init } = stdbBffCommandPost("reset_leave_to_draft", { companyId: companyId, leaveId: toScalarU64(leaveId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to reset leave to draft')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] })
    },
  })
}

// ── Mutations: Contract Workflow ────────────────────────────────────────────

