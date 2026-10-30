import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordCreationRecovery } from '../../../../web/components/record-creation-recovery';
import { recordCreationStorageKey, type PendingRecordCreation } from '@lumiere/query-hooks/hooks/record-creation-invocation';

const mocked = vi.hoisted(() => ({ identity: 'ab'.repeat(32), read: vi.fn(), write: vi.fn() }));
vi.mock('@lumiere/erp-session', () => ({ useErpSession: () => ({ identity: mocked.identity }) }));
vi.mock('@lumiere/query-hooks/http', () => ({ fetchQueryList: mocked.read, apiFetch: mocked.write }));
vi.mock('@lumiere/i18n', () => ({ useTranslation: () => ({ t: (key: string) => (Reflect.get({
  'common.creationRecovery.title': 'Review an earlier save', 'common.creationRecovery.review': 'Review entered values',
  'common.creationRecovery.reviewHint': 'Your current form stays open. Checking status does not send another save.',
  'common.creationRecovery.check': 'Check save status', 'common.creationRecovery.finish': 'Finish review',
  'common.creationRecovery.openSaved': 'Open saved record in a new tab', 'common.creationRecovery.emptyValue': 'Empty',
  'common.creationRecovery.status.unknown': 'No saved result was confirmed', 'common.creationRecovery.status.denied': 'Entries are hidden',
  'common.creationRecovery.status.unavailable': 'Save unavailable', 'common.close': 'Close',
}, key) ?? key) }) }));

const scope = { organizationId: 1n, companyId: 2n, actorHex: 'ab'.repeat(32) };
const key = recordCreationStorageKey(scope, 'contact');
const pending: PendingRecordCreation = {
  version: 1, organizationId: '1', companyId: '2', actorHex: scope.actorHex, model: 'contact', operationKey: 'pending-contact',
  payloadJson: JSON.stringify({ name: 'Earlier Ada', metadata: { some: '{"custom:score":0,"custom:approved":false,"custom:empty":""}' } }),
  requestJson: '{"params":{"name":"Earlier Ada"}}', phase: 'uncertain',
};
const receipt = { id: '1:2:contact:pending-contact', organization_id: '1', company_id: '2', model: 'contact', operation_key: 'pending-contact', record_id: '9007199254740993', payload_hash: `sha256:${'cd'.repeat(32)}` };
const models = [{ model: 'contact' as const, canRead: true }];
const component = (companyId = 2n, canRead = true) => <><input aria-label="Current draft" defaultValue="Different current client" /><RecordCreationRecovery organizationId={1n} companyId={companyId} models={[{ model: 'contact', canRead }]} /></>;

beforeEach(() => {
  mocked.identity = scope.actorHex;
  mocked.read.mockReset(); mocked.read.mockResolvedValue([]); mocked.write.mockReset();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn(async (_name: string, callback: () => unknown) => callback()) } });
  localStorage.clear(); localStorage.setItem(key, JSON.stringify(pending));
});
afterEach(cleanup);

describe('visible configured-create recovery with the production hook', () => {
  it('reviews retained false/zero/empty input and hands off the exact old record without saving or replacing the current draft', async () => {
    mocked.read.mockResolvedValue([receipt]);
    render(component());
    fireEvent.change(screen.getByLabelText('Current draft'), { target: { value: 'Edited current client' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Review entered values' }));
    const dialog = screen.getByTestId('record-creation-review');
    expect(within(dialog).getByText('Earlier Ada')).not.toBeNull();
    expect(within(dialog).getByText('false')).not.toBeNull();
    expect(within(dialog).getByText('0')).not.toBeNull();
    expect(within(dialog).getByText('Empty')).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check save status' }));
    const link = await within(dialog).findByRole('link', { name: 'Open saved record in a new tab' });
    expect(link.getAttribute('href')).toBe('/crm?tab=contacts&filter=id%3A9007199254740993');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(localStorage.getItem(key)).not.toBeNull();
    expect((screen.getByLabelText('Current draft') as HTMLInputElement).value).toBe('Edited current client');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Finish review' }));
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
    expect(mocked.read).toHaveBeenCalledTimes(2);
    expect(mocked.read.mock.calls[0][0]).toBe('/api/query/contact-creations?companyId=2&operationKey=pending-contact');
    expect(mocked.write).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Current draft') as HTMLInputElement).value).toBe('Edited current client');
  });

  it('keeps an unknown attempt across reload and never provides a finish or replacement action without its receipt', async () => {
    const first = render(component());
    fireEvent.click(await screen.findByRole('button', { name: 'Check save status' }));
    await screen.findByText(/No saved result was confirmed/);
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Finish review' })).toBeNull();
    first.unmount();
    render(component());
    expect(await screen.findByRole('button', { name: 'Review entered values' })).not.toBeNull();
    expect(mocked.write).not.toHaveBeenCalled();
  });

  it('hides denied entries immediately and keeps them hidden through focus until an authorized status retry', async () => {
    mocked.read.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    render(component());
    fireEvent.click(await screen.findByRole('button', { name: 'Review entered values' }));
    expect(screen.getByText('Earlier Ada')).not.toBeNull();
    fireEvent.click(within(screen.getByTestId('record-creation-review')).getByRole('button', { name: 'Check save status' }));
    await screen.findByText(/Entries are hidden/);
    expect(screen.queryByText('Earlier Ada')).toBeNull();
    fireEvent.focus(window);
    expect(screen.queryByRole('button', { name: 'Review entered values' })).toBeNull();
    mocked.read.mockResolvedValue([receipt]);
    fireEvent.click(screen.getByRole('button', { name: 'Check save status' }));
    await screen.findByText('Earlier Ada');
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(mocked.write).not.toHaveBeenCalled();
  });

  it('rejects late A-to-B-to-A reads and hides protected content when actor, company or access changes', async () => {
    let finish: (rows: typeof receipt[]) => void = () => {};
    mocked.read.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { rerender } = render(component());
    fireEvent.click(await screen.findByRole('button', { name: 'Check save status' }));
    await waitFor(() => expect(mocked.read).toHaveBeenCalledTimes(1));
    rerender(component(3n));
    expect(screen.queryByTestId('record-creation-recovery')).toBeNull();
    rerender(component());
    await screen.findByTestId('record-creation-recovery');
    await act(async () => { finish([receipt]); });
    expect(screen.queryByRole('link', { name: 'Open saved record in a new tab' })).toBeNull();
    expect(localStorage.getItem(key)).not.toBeNull();
    rerender(component(2n, false));
    expect(screen.queryByTestId('record-creation-recovery')).toBeNull();
    mocked.identity = 'ef'.repeat(32);
    rerender(component());
    expect(screen.queryByTestId('record-creation-recovery')).toBeNull();
    expect(mocked.write).not.toHaveBeenCalled();
  });

  it('keeps corrupt checkpoints and rejects them before a network call', async () => {
    localStorage.setItem(key, '{"version":1}');
    render(<RecordCreationRecovery organizationId={1n} companyId={2n} models={models} />);
    await screen.findByText(/Save unavailable/);
    fireEvent.click(screen.getByRole('button', { name: 'Check save status' }));
    await waitFor(() => expect(screen.getByText(/Save unavailable/)).not.toBeNull());
    expect(localStorage.getItem(key)).toBe('{"version":1}');
    expect(mocked.read).not.toHaveBeenCalled();
    expect(mocked.write).not.toHaveBeenCalled();
  });
});
