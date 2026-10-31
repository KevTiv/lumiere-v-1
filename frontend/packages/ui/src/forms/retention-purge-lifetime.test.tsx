import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '../../../query-hooks/node_modules/@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const controls = vi.hoisted(() => ({ fetch: vi.fn(), rows: vi.fn(), confirm: vi.fn() }));
vi.mock('@lumiere/query-hooks/http', () => ({ apiFetch: controls.fetch, fetchQueryList: controls.rows, rqBigIntKey: String }));
// Scope tests exercise the real mutation owners; the coordinated contract gate owns wire encoding.
vi.mock('@lumiere/stdb/commands', () => ({ stdbBffCommandPost: (name: string, body: unknown) => ({ urlPath: `/commands/${name}`, init: { method: 'POST', body: JSON.stringify(body, (_key, value) => typeof value === 'bigint' ? String(value) : value) } }) }));
vi.mock('@lumiere/erp-shared/stdb-params-json', () => ({ stdbParamsToJson: (value: unknown) => value }));
import { readRetentionPreview } from '@lumiere/query-hooks/hooks/document-retention-preview';
import { usePurgeExpiredDocuments, useScheduleDocumentRetentionPurge } from '@lumiere/query-hooks/hooks/documents';
import { reviewRetentionPurgeScope, useRetentionPurgeAuthority } from '../../../../web/app/(modules)/documents/retention-purge-review';

const message = 'Your company or document permissions changed. Reopen the purge preview.';
const scopeA = 'organization:7:actor:A:company:8';
const preview = { data: { organizationId: '7', scope: 'organization', delaySeconds: 0,
  evaluatedAtMicros: '1000000', cutoffMicros: '1000000', fingerprint: 'ab'.repeat(32),
  documents: [{ id: '9007199254740993', name: 'Reviewed receipt', companyId: '8', purgeAfterMicros: '900000' }],
  complete: true, canProceed: true, unreviewableCount: 0, heldCount: 1 } };
const response = () => new Response(JSON.stringify(preview), { status: 200 });
const posts = () => controls.fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { mutations: { retry: false } } }));
  return <StrictMode><QueryClientProvider client={client}>{children}</QueryClientProvider></StrictMode>;
}
function Owner({ scopeKey = scopeA, admitted = true }: { scopeKey?: string; admitted?: boolean }) {
  const authority = useRetentionPurgeAuthority(scopeKey, admitted, admitted, message);
  const purge = usePurgeExpiredDocuments(7n, () => authority.mayDispatch(0));
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  const review = async () => {
    try {
      const result = await reviewRetentionPurgeScope(authority, 0, {
        read: () => readRetentionPreview(7n, 0),
        validate: (value) => { if (!value.canProceed || value.documents.length === 0) throw new Error('Incomplete review'); },
        confirm: controls.confirm,
      });
      if (!result) return;
      authority.assertCurrent(0);
      await purge.mutateAsync(result.documents.map((document) => document.id));
      setStatus('Purge requested');
    } catch (error) { setStatus((error as Error).message); }
  };
  return <><input aria-label="Review draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
    <button onClick={review}>Review and purge</button><output>{status}</output></>;
}
beforeEach(() => {
  controls.fetch.mockReset().mockImplementation((_url, init) => Promise.resolve(init?.method === 'POST' ? new Response(null, { status: 204 }) : response()));
  controls.rows.mockReset().mockResolvedValue([]);
  controls.confirm.mockReset().mockResolvedValue(true);
});
afterEach(cleanup);

describe('retention review and dispatch share a mounted scope lifetime', () => {
  it.each(['actor', 'company'])('a pending final preview cannot survive %s A-to-B-to-A, and the latest review remains usable', async (change) => {
    const finalRead = deferred<Response>();
    controls.fetch.mockResolvedValueOnce(response()).mockReturnValueOnce(finalRead.promise);
    const view = render(<Owner />, { wrapper });
    fireEvent.change(screen.getByLabelText('Review draft'), { target: { value: 'Keep my review notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review and purge' }));
    await waitFor(() => expect(controls.fetch).toHaveBeenCalledTimes(2));
    expect(controls.confirm).toHaveBeenCalledTimes(1);
    view.rerender(<Owner scopeKey={change === 'actor' ? 'organization:7:actor:B:company:8' : 'organization:7:actor:A:company:9'} />);
    view.rerender(<Owner />);
    await act(async () => { finalRead.resolve(response()); });
    await screen.findByText(message);
    expect(posts()).toHaveLength(0);
    expect((screen.getByLabelText('Review draft') as HTMLInputElement).value).toBe('Keep my review notes');
    fireEvent.click(screen.getByRole('button', { name: 'Review and purge' }));
    await screen.findByText('Purge requested');
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0]![1].body)).toEqual({ documentIds: ['9007199254740993'] });
    expect((screen.getByLabelText('Review draft') as HTMLInputElement).value).toBe('Keep my review notes');
  });

  it('withdrawing and restoring admission invalidates an initial preview without clearing the draft', async () => {
    const initialRead = deferred<Response>();
    controls.fetch.mockReturnValueOnce(initialRead.promise);
    const view = render(<Owner />, { wrapper });
    fireEvent.change(screen.getByLabelText('Review draft'), { target: { value: 'Retain this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review and purge' }));
    await waitFor(() => expect(controls.fetch).toHaveBeenCalledTimes(1));
    view.rerender(<Owner admitted={false} />);
    view.rerender(<Owner />);
    await act(async () => { initialRead.resolve(response()); });
    await screen.findByText(message);
    expect(controls.confirm).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(0);
    expect((screen.getByLabelText('Review draft') as HTMLInputElement).value).toBe('Retain this draft');
  });

  it('old dispatch guards stay expired after the same key returns, while StrictMode and the current lifetime work', () => {
    const { result, rerender, unmount } = renderHook(({ scopeKey, immediate, scheduled }) => useRetentionPurgeAuthority(scopeKey, immediate, scheduled, message), {
      wrapper, initialProps: { scopeKey: scopeA, immediate: true, scheduled: true },
    });
    const first = result.current;
    expect(first.mayDispatch(0)).toBe(true);
    expect(first.mayDispatch(60)).toBe(true);
    rerender({ scopeKey: `${scopeA}:other`, immediate: true, scheduled: true });
    rerender({ scopeKey: scopeA, immediate: true, scheduled: true });
    expect(first.mayDispatch(0)).toBe(false);
    expect(first.mayDispatch(60)).toBe(false);
    expect(() => first.assertCurrent(0)).toThrow(message);
    const beforeAdmission = result.current;
    rerender({ scopeKey: scopeA, immediate: true, scheduled: false });
    rerender({ scopeKey: scopeA, immediate: true, scheduled: true });
    expect(beforeAdmission.mayDispatch(60)).toBe(false);
    expect(result.current.mayDispatch(0)).toBe(true);
    const latest = result.current;
    unmount();
    expect(latest.mayDispatch(0)).toBe(false);
    expect(latest.mayDispatch(60)).toBe(false);
  });

  it('a confirmation resolving after unmount cannot request a purge', async () => {
    const confirmation = deferred<boolean>();
    controls.confirm.mockReturnValueOnce(confirmation.promise);
    const view = render(<Owner />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Review and purge' }));
    await waitFor(() => expect(controls.confirm).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => { confirmation.resolve(true); });
    expect(controls.fetch).toHaveBeenCalledTimes(1);
    expect(posts()).toHaveLength(0);
  });

  it('the actual scheduler rejects its old dispatch guard after a pending read and A-to-B-to-A', async () => {
    const beforeJobs = deferred<never[]>();
    controls.rows.mockReturnValueOnce(beforeJobs.promise);
    const { result, rerender } = renderHook(({ scopeKey }) => {
      const authority = useRetentionPurgeAuthority(scopeKey, true, true, message);
      return useScheduleDocumentRetentionPurge(7n, () => authority.mayDispatch(60));
    }, { wrapper, initialProps: { scopeKey: scopeA } });
    const pending = result.current.mutateAsync({ delaySeconds: 60 });
    const rejected = expect(pending).rejects.toThrow();
    await waitFor(() => expect(controls.rows).toHaveBeenCalledTimes(1));
    rerender({ scopeKey: `${scopeA}:other` }); rerender({ scopeKey: scopeA });
    await act(async () => { beforeJobs.resolve([]); });
    await rejected;
    expect(posts()).toHaveLength(0);
  });
});
