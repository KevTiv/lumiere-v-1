import assert from 'node:assert/strict';
import test from 'node:test';
import { createInvoiceEmailQueueClient, invoiceEmailQueueRequest } from './invoice-email-transport';
import { invoiceEmailContext, invoiceEmailRecordRevision, type InvoiceEmailSubmission } from '../../../../../../packages/ui/src/accounting-components/invoice-email-review';

const submission: InvoiceEmailSubmission = {
  reviewId: 'review-unique', recipient: 'customer@example.test',
  document: { organizationId: 1n, companyId: 3n, moveId: 42n, reference: 'INV/42', partner: 'Customer', companyName: 'Our company', totalLabel: 'EUR 120', pdfFilename: 'account-move-42.pdf', posted: true, revision: invoiceEmailRecordRevision({ state: { tag: 'Posted' }, moveType: { tag: 'OutInvoice' }, amountTotal: 120, currencyId: 90n, name: 'INV/42', invoicePartnerDisplayName: 'Customer' }) },
  template: { id: 9n, organizationId: 1n, companyId: undefined, name: 'Invoice email', model: 'account_move', subject: 'Your invoice', bodyHtml: 'Your invoice is ready.', attachDocument: false, isDefault: true, isActive: true },
};
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value), { status, headers: { 'content-type': 'application/json' } });
const templates = () => json({ data: [{ ...submission.template, companyId: null }] });
const record = (amountTotal = 120) => json({ data: [{ id: 42, organizationId: 1, companyId: 3, state: 'Posted', moveType: 'OutInvoice', name: 'INV/42', invoicePartnerDisplayName: 'Customer', currencyId: 90, amountTotal }] });
const message = (delivery = 'queued') => ({ id: '11', organizationId: '1', model: 'account_move', resId: '42', body: submission.template.bodyHtml,
  metadata: JSON.stringify({ delivery, to: submission.recipient, subject: submission.template.subject, html: submission.template.bodyHtml, mail_template_id: 9, context_json: invoiceEmailContext(submission) }) });

test('queue command uses canonical nested Option encoding and exact IDs without Number coercion', () => {
  const command = invoiceEmailQueueRequest(submission);
  const body = JSON.parse(String(command.init.body)) as { companyId: number; params: { template_id: number; res_id: number; context_json: { some: string } } };
  assert.equal(body.companyId, 3);
  assert.equal(body.params.template_id, 9);
  assert.equal(body.params.res_id, 42);
  assert.deepEqual(body.params.context_json, { some: invoiceEmailContext(submission) });
  assert.match(command.urlPath, /erp.queue_mail_from_template/);
});

test('queues one reviewed message and confirms the exact record without calling dispatch', async () => {
  let posted = false; const calls: string[] = [];
  const client = createInvoiceEmailQueueClient(async (path, init) => {
    calls.push(path);
    if (path === '/api/query/mail-templates') return templates();
    if (path.startsWith('/api/query/account-moves?')) return record();
    if (path === '/api/query/mail-messages') return json({ data: posted ? [message()] : [] });
    assert.equal(init?.method, 'POST'); posted = true; return json({ ok: true });
  });
  const outcome = await client.queue(submission);
  assert.equal(outcome.status, 'queued');
  if (outcome.status === 'queued') assert.equal(outcome.messageId, 11n);
  assert.equal(calls.filter((path) => path.startsWith('/api/operations/')).length, 1);
  assert.equal(calls.some((path) => path.includes('dispatch')), false);
});

test('reconciles a response lost after creation and never automatically repeats that review POST', async () => {
  let posted = false; let posts = 0;
  const client = createInvoiceEmailQueueClient(async (path) => {
    if (path === '/api/query/mail-templates') return templates();
    if (path.startsWith('/api/query/account-moves?')) return record();
    if (path === '/api/query/mail-messages') return json({ data: posted ? [message()] : [] });
    posts += 1; posted = true; throw new TypeError('response lost');
  });
  assert.equal((await client.queue(submission)).status, 'queued');
  assert.equal((await client.queue(submission)).status, 'queued');
  assert.equal(posts, 1);
});

test('retains unknown without requeueing when no exact record can be found', async () => {
  let posts = 0;
  const client = createInvoiceEmailQueueClient(async (path) => {
    if (path === '/api/query/mail-templates') return templates();
    if (path.startsWith('/api/query/account-moves?')) return record();
    if (path === '/api/query/mail-messages') return json({ data: [] });
    posts += 1; throw new TypeError('unknown result');
  });
  assert.equal((await client.queue(submission)).status, 'unknown');
  assert.equal((await client.queue(submission)).status, 'unknown');
  assert.equal((await client.check(submission)).status, 'unknown');
  assert.equal(posts, 1);
});

test('a changed template, denied preflight, or changed active scope prevents a new queue', async () => {
  for (const mode of ['changed', 'denied', 'scope', 'record'] as const) {
    let posts = 0;
    const client = createInvoiceEmailQueueClient(async (path) => {
      if (path === '/api/query/mail-templates') return mode === 'denied' ? json({ error: 'Denied' }, 403)
        : mode === 'changed' ? json({ data: [{ ...submission.template, companyId: null, bodyHtml: 'Unreviewed update' }] }) : templates();
      if (path === '/api/query/mail-messages') return json({ data: [] });
      if (path.startsWith('/api/query/account-moves?')) return record(mode === 'record' ? 121 : 120);
      posts += 1; return json({ ok: true });
    });
    assert.equal((await client.queue(submission, () => mode !== 'scope')).status, 'rejected');
    assert.equal(posts, 0);
  }
});

test('read-only recovery can identify an exact dispatcher record but cannot claim recipient delivery', async () => {
  let posts = 0;
  const client = createInvoiceEmailQueueClient(async (_path, init) => {
    if (init?.method === 'POST') posts += 1;
    return json({ data: [message('sent')] });
  });
  const outcome = await client.check(submission);
  assert.equal(outcome.status, 'dispatched');
  assert.equal(posts, 0);
});

test('large canonical IDs are rejected before write if the existing serializer cannot represent them exactly', async () => {
  const large = { ...submission, template: { ...submission.template, id: 9007199254740993n } };
  let posts = 0;
  const client = createInvoiceEmailQueueClient(async (path) => {
    if (path === '/api/query/mail-templates') return json({ data: [{ ...large.template, companyId: null }] });
    if (path.startsWith('/api/query/account-moves?')) return record();
    if (path === '/api/query/mail-messages') return json({ data: [] });
    posts += 1; return json({ ok: true });
  });
  const outcome = await client.queue(large);
  assert.equal(outcome.status, 'rejected');
  if (outcome.status === 'rejected') assert.match(outcome.message, /cannot represent this request exactly/);
  assert.equal(posts, 0);
});
