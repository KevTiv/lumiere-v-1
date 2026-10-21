import assert from 'node:assert/strict';
import test from 'node:test';

import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';

import { canRequestSignature, parseSignerEmails, toSignatureRequestParams } from './signature-request';

test('a deleted document cannot be sent for signature', () => {
  assert.equal(canRequestSignature({ isDeleted: false }), true);
  assert.equal(canRequestSignature({}), true);
  assert.equal(canRequestSignature({ isDeleted: true }), false);
  assert.equal(canRequestSignature({ is_deleted: true }), false);
});

test('provider and envelope id are required and trimmed', () => {
  assert.deepEqual(toSignatureRequestParams({ provider: '  ', externalEnvelopeId: 'e1' }), { ok: false, reason: 'provider' });
  assert.deepEqual(toSignatureRequestParams({ provider: 'DocuSign', externalEnvelopeId: ' ' }), { ok: false, reason: 'envelope' });
  assert.deepEqual(toSignatureRequestParams(null), { ok: false, reason: 'provider' });
  const r = toSignatureRequestParams({ provider: ' DocuSign ', externalEnvelopeId: ' env-1 ' });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.params.provider, 'DocuSign');
  assert.equal(r.ok && r.params.externalEnvelopeId, 'env-1');
});

test('signers are optional, split on lines and commas, de-duplicated and validated', () => {
  assert.deepEqual(parseSignerEmails(''), []);
  assert.deepEqual(parseSignerEmails('a@x.com\nb@y.org, A@X.com ; c@z.io'), ['a@x.com', 'b@y.org', 'c@z.io']);
  assert.equal(parseSignerEmails('a@x.com, nope'), null);
  assert.deepEqual(toSignatureRequestParams({ provider: 'p', externalEnvelopeId: 'e', signers: 'bad' }), { ok: false, reason: 'signers' });
});

test('the wire body spells signers_json and metadata explicitly', () => {
  const none = toSignatureRequestParams({ provider: 'p', externalEnvelopeId: 'e' });
  assert.deepEqual(stdbParamsToJson((none as { params: object }).params, 'CreateDocumentSignatureRequestParams'), {
    provider: 'p',
    external_envelope_id: 'e',
    signers_json: { none: [] },
    metadata: { none: [] },
  });
  const some = toSignatureRequestParams({ provider: 'p', externalEnvelopeId: 'e', signers: 'a@x.com\nb@y.org' });
  assert.deepEqual(stdbParamsToJson((some as { params: object }).params, 'CreateDocumentSignatureRequestParams').signers_json, {
    some: '[{"email":"a@x.com"},{"email":"b@y.org"}]',
  });
});
