import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '../../../query-hooks/node_modules/@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const controls = vi.hoisted(() => ({ read: vi.fn(), post: vi.fn() }));
vi.mock('@lumiere/query-hooks/http', () => ({ fetchQueryList: controls.read, apiFetch: controls.post, rqBigIntKey: (value: bigint) => String(value) }));
// This suite isolates scope lifetimes; the coordinated generated-contract gate owns wire encoding.
vi.mock('@lumiere/erp-shared/stdb-params-json', () => ({ stdbParamsToJson: (value: object) => value }));
import { useRenewSubscription } from '@lumiere/query-hooks/hooks/subscriptions';

const actor = 'ab'.repeat(32);
const request = { idempotencyKey: 'one-renewal', intervals: 2, notes: 'Extend support' };
const params = { intervals: 2, notes: request.notes, idempotencyKey: request.idempotencyKey };
const variables = { subscriptionId: 41n, request, params };
const receipt = { id: '91', organizationId: '7', companyId: '8', subscriptionId: '41', createdBy: actor, amendmentType: 'renew', version: 3, notes: request.notes,
  metadata: JSON.stringify({ idempotency_key: request.idempotencyKey, request_fingerprint: 'cd'.repeat(32) }), afterJson: JSON.stringify({ intervals: 2, recurring_next_date: 1_800_000_000 }) };

function wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { mutations: { retry: false } } }));
  return <StrictMode><QueryClientProvider client={client}>{children}</QueryClientProvider></StrictMode>;
}
beforeEach(() => { controls.read.mockReset(); controls.post.mockReset(); });
afterEach(cleanup);

describe('actual renewal mutation scope lifetime', () => {
  it('keeps a StrictMode lifetime usable for an exact already-saved receipt', async () => {
    controls.read.mockResolvedValue([receipt]);
    const { result } = renderHook(() => useRenewSubscription(7n, 8n, actor), { wrapper });
    let resolved: unknown;
    await act(async () => { resolved = await result.current.mutateAsync(variables); });
    expect(resolved).toMatchObject({ kind: 'already-applied', ref: { id: '91' } });
    expect(controls.post).not.toHaveBeenCalled();
  });

  it('an actor A-to-B-to-A transition cannot revive a pending pre-dispatch read', async () => {
    let finish: (rows: never[]) => void = () => {};
    controls.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(({ identity }) => useRenewSubscription(7n, 8n, identity), { initialProps: { identity: actor }, wrapper });
    const mutation = result.current.mutateAsync(variables);
    const rejected = expect(mutation).rejects.toThrow('Renewal actor, company or admission changed');
    await waitFor(() => expect(controls.read).toHaveBeenCalledTimes(1));
    rerender({ identity: 'ef'.repeat(32) }); rerender({ identity: actor });
    await act(async () => { finish([]); });
    await rejected;
    expect(controls.post).not.toHaveBeenCalled();
  });

  it('company A-to-B-to-A and withdrawn admission invalidate the original intent', async () => {
    for (const change of ['company', 'admission']) {
      controls.read.mockReset();
      let finish: (rows: never[]) => void = () => {};
      controls.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      const { result, rerender, unmount } = renderHook(({ company, admitted }) => useRenewSubscription(7n, company, actor, admitted), { initialProps: { company: 8n, admitted: true }, wrapper });
      const mutation = result.current.mutateAsync(variables);
      const rejected = expect(mutation).rejects.toThrow('Renewal actor, company or admission changed');
      await waitFor(() => expect(controls.read).toHaveBeenCalledTimes(1));
      rerender(change === 'company' ? { company: 9n, admitted: true } : { company: 8n, admitted: false });
      rerender({ company: 8n, admitted: true });
      await act(async () => { finish([]); });
      await rejected;
      expect(controls.post).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('unmounting the editor during a read prevents a late renewal write', async () => {
    let finish: (rows: never[]) => void = () => {};
    controls.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result, unmount } = renderHook(() => useRenewSubscription(7n, 8n, actor), { wrapper });
    const mutation = result.current.mutateAsync(variables);
    const rejected = expect(mutation).rejects.toThrow('Renewal actor, company or admission changed');
    await waitFor(() => expect(controls.read).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => { finish([]); });
    await rejected;
    expect(controls.post).not.toHaveBeenCalled();
  });
});
