'use client';

import { decodeOperationDispatch } from '@lumiere/api-client';
import { stdbBffCommandPost } from '@lumiere/stdb/commands';
/**
 * POS hooks — Point of Sale terminal and session management
 *
 * Wraps REST API calls with React Query for the POS module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { apiFetch, fetchQueryList, rqBigIntKey } from '../http';
import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';
import {
  parseStrictU64,
  scalarToU64 as toScalarU64,
  type ScalarId,
} from '@lumiere/erp-shared/u64';
import type { CreatePosConfigParams, CreatePosOrderParams, PosConfig, PosSession, PosTerminal } from '@lumiere/stdb/types';
import {
  AmbiguousOperationEffectError,
  executeOperationWithCanonicalReadback,
  requireResolvedOperationEffect,
  type CanonicalRecordRef,
  type ResolvedOperationEffectOutcome,
} from './operation-effect';
import {
  resolvePosConfigStateEffect,
  type PosConfigStateRef,
} from './pos-config-state-effect';

// ── Reads ────────────────────────────────────────────────────────────────────

export function usePosTerminals(
  organizationId: bigint,
  initialData?: PosTerminal[],
) {
  return useQuery<PosTerminal[]>({
    queryKey: ['pos-terminals', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/pos-terminals',
        'Failed to fetch POS terminals',
      ),
    staleTime: 30_000,
    initialData,
  });
}

export function usePosConfigs(organizationId: bigint, initialData?: PosConfig[]) {
  return useQuery<PosConfig[]>({
    queryKey: ['pos-configs', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/pos-configs', 'Failed to fetch POS configs'),
    staleTime: 30_000,
    initialData,
  });
}

export function usePosSessions(
  organizationId: bigint,
  initialData?: PosSession[],
) {
  return useQuery<PosSession[]>({
    queryKey: ['pos-sessions', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/pos-sessions', 'Failed to fetch POS sessions'),
    staleTime: 15_000,
    initialData,
  });
}

// ── Query invalidation helper ───────────────────────────────────────────────

function invalidatePosQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
) {
  const key = rqBigIntKey(organizationId);
  void qc.invalidateQueries({ queryKey: ['pos-terminals', key] });
  void qc.invalidateQueries({ queryKey: ['pos-configs', key] });
  void qc.invalidateQueries({ queryKey: ['pos-sessions', key] });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreatePosTerminal(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const name = String(params.name ?? '').trim();
      if (!name) throw new Error('Terminal name is required');
      const loc = params.locationLabel;
      const locationLabel =
        loc != null && String(loc).trim() !== '' ? String(loc).trim() : null;
      const latRaw = params.latitude;
      const lonRaw = params.longitude;
      const latitude = latRaw != null && latRaw !== '' ? Number(latRaw) : null;
      const longitude = lonRaw != null && lonRaw !== '' ? Number(lonRaw) : null;
      const { urlPath, init } = stdbBffCommandPost('create_pos_terminal', {
        companyId,
        name,
        locationLabel,
        latitude:
          latitude != null && Number.isFinite(latitude) ? latitude : null,
        longitude:
          longitude != null && Number.isFinite(longitude) ? longitude : null,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create POS terminal');
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  });
}

export function useUpdatePosTerminal(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      terminalId: ScalarId;
      status: string;
      dailyRevenue: number;
      openOrders: number;
    }) => {
      const { urlPath, init } = stdbBffCommandPost('update_pos_terminal', {
        terminalId: toScalarU64(args.terminalId),
        status: args.status,
        dailyRevenue: args.dailyRevenue,
        openOrders: Math.max(0, Math.floor(args.openOrders)) >>> 0,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update POS terminal');
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  });
}

export function useCreatePosConfig(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreatePosConfigParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('create_pos_config', {
        companyId: companyId,
        params: stdbParamsToJson(params as object, 'CreatePosConfigParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create POS config');
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  });
}

function useSetPosConfigActive(organizationId: bigint, isActive: boolean) {
  const qc = useQueryClient();
  return useMutation<
    ResolvedOperationEffectOutcome<PosConfigStateRef>,
    Error,
    ScalarId
  >({
    mutationFn: async (configIdInput) => {
      const configId = parseStrictU64(configIdInput);
      if (configId == null) throw new Error('Invalid POS config id');

      const resolveEffect = async () =>
        resolvePosConfigStateEffect(
          await fetchQueryList(
            '/api/query/pos-configs',
            'Failed to read POS configs',
          ),
          organizationId,
          configId,
          isActive,
        );

      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect,
        dispatch: async () => {
          const operation = isActive
            ? 'activate_pos_config'
            : 'deactivate_pos_config';
          const { urlPath, init } = stdbBffCommandPost(operation, {
            configId,
          });
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            `Failed to ${isActive ? 'activate' : 'deactivate'} POS config`,
          );
        },
        afterDispatch: () => invalidatePosQueries(qc, organizationId),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      });

      return requireResolvedOperationEffect(outcome);
    },
  });
}

export function useActivatePosConfig(organizationId: bigint) {
  return useSetPosConfigActive(organizationId, true);
}

export function useDeactivatePosConfig(organizationId: bigint) {
  return useSetPosConfigActive(organizationId, false);
}

export function useOpenPosSession(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      configId: bigint | number | string;
      openingBalance?: number;
    }) => {
      const { urlPath, init } = stdbBffCommandPost('open_pos_session', {
        configId: toScalarU64(args.configId),
        cashRegisterBalanceStart: args.openingBalance ?? 0,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to open POS session');
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  });
}

export interface PosSessionCloseProjection {
  readonly id?: unknown;
  readonly organizationId?: unknown;
  readonly organization_id?: unknown;
  readonly configId?: unknown;
  readonly config_id?: unknown;
  readonly state?: unknown;
  readonly stopAt?: unknown;
  readonly stop_at?: unknown;
  readonly cashRegisterBalanceEndReal?: unknown;
  readonly cash_register_balance_end_real?: unknown;
}

export interface PosConfigScopeProjection {
  readonly id?: unknown;
  readonly organizationId?: unknown;
  readonly organization_id?: unknown;
  readonly companyId?: unknown;
  readonly company_id?: unknown;
}

export interface ClosedPosSessionRef extends CanonicalRecordRef {
  readonly resource: 'pos-sessions';
  readonly configId: string;
  readonly companyId: string;
  readonly closingBalance: number;
}

function posStateTag(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ('tag' in value) {
      return String((value as { tag?: unknown }).tag ?? '').toLowerCase();
    }
    const keys = Object.keys(value);
    if (keys.length === 1) return keys[0]!.toLowerCase();
  }
  return '';
}

/** COV-13: resolve the same session through its canonical config/company relation. */
export function resolveClosedPosSessionEffect(
  sessions: readonly PosSessionCloseProjection[],
  configs: readonly PosConfigScopeProjection[],
  organizationId: bigint,
  companyId: bigint,
  sessionId: bigint,
  closingBalance: number,
): ClosedPosSessionRef | null {
  const sessionMatches = sessions.filter(
    (row) => parseStrictU64(row.id) === sessionId,
  );
  if (sessionMatches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one POS session, found ${sessionMatches.length}`,
    );
  }
  const session = sessionMatches[0];
  if (
    !session ||
    parseStrictU64(session.organizationId ?? session.organization_id) !==
      organizationId ||
    posStateTag(session.state) !== 'closed'
  ) {
    return null;
  }

  const configId = parseStrictU64(session.configId ?? session.config_id);
  if (configId == null) return null;
  const configMatches = configs.filter(
    (row) => parseStrictU64(row.id) === configId,
  );
  if (configMatches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one POS config, found ${configMatches.length}`,
    );
  }
  const config = configMatches[0];
  if (
    !config ||
    parseStrictU64(config.organizationId ?? config.organization_id) !==
      organizationId ||
    parseStrictU64(config.companyId ?? config.company_id) !== companyId
  ) {
    return null;
  }

  const actualBalance = Number(
    session.cashRegisterBalanceEndReal ??
      session.cash_register_balance_end_real ??
      Number.NaN,
  );
  if (
    !Number.isFinite(actualBalance) ||
    Math.abs(actualBalance - closingBalance) > 0.0001
  ) {
    return null;
  }

  return {
    resource: 'pos-sessions',
    id: sessionId.toString(),
    configId: configId.toString(),
    companyId: companyId.toString(),
    closingBalance: actualBalance,
  };
}

export function useClosePosSession(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    ResolvedOperationEffectOutcome<ClosedPosSessionRef>,
    Error,
    {
      sessionId: bigint | number | string;
      closingBalance: number;
    }
  >({
    mutationFn: async (args) => {
      if (companyId == null || companyId <= 0n) {
        throw new Error('Operating company is required to close a POS session');
      }
      const sessionId = parseStrictU64(args.sessionId);
      if (sessionId == null) throw new Error('Invalid POS session id');

      const resolveEffect = async () =>
        resolveClosedPosSessionEffect(
          await fetchQueryList(
            '/api/query/pos-sessions',
            'Failed to read POS sessions',
          ),
          await fetchQueryList(
            '/api/query/pos-configs',
            'Failed to read POS configs',
          ),
          organizationId,
          companyId,
          sessionId,
          args.closingBalance,
        );

      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect,
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost('close_pos_session', {
            sessionId,
            cashRegisterBalanceEndReal: args.closingBalance,
          });
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            'Failed to close POS session',
          );
        },
        afterDispatch: () => invalidatePosQueries(qc, organizationId),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      });

      return requireResolvedOperationEffect(outcome);
    },
  });
}

export function useComputePosSessionTotals(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost(
        'compute_pos_session_totals',
        { sessionId: toScalarU64(sessionId) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to compute POS session totals');
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  });
}

export function useCreatePosOrder(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreatePosOrderParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('create_pos_order', {
        params: stdbParamsToJson(params as object, 'CreatePosOrderParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create POS order');
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  });
}
