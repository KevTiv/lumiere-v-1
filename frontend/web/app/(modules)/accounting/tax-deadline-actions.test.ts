import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canCompleteTaxDeadline,
  canDeleteTaxDeadline,
  canEditTaxDeadline,
  canWaiveTaxDeadline,
  deadlineDateInput,
  toTaxDeadlineCreateBody,
  toTaxDeadlineUpdateBody,
  toTaxDeadlineUpdateValues,
} from './tax-deadline-actions';

const deadline = (status: string, extra: Record<string, unknown> = {}) => ({ id: 1, status: { tag: status }, ...extra });

test('complete and waive are offered only while a deadline is open', () => {
  assert.deepEqual(
    ['Upcoming', 'DueSoon', 'Overdue', 'Completed', 'Waived'].map((s) => [
      canCompleteTaxDeadline(deadline(s)),
      canWaiveTaxDeadline(deadline(s)),
    ]),
    [
      [true, true],
      [true, true],
      [true, true],
      [false, false],
      [false, false],
    ],
  );
});

test('a deleted deadline offers no action', () => {
  const gone = deadline('Upcoming', { deletedAt: { microsSinceUnixEpoch: 1n } });
  assert.equal(canCompleteTaxDeadline(gone), false);
  assert.equal(canWaiveTaxDeadline(gone), false);
  assert.equal(canEditTaxDeadline(gone), false);
  assert.equal(canDeleteTaxDeadline(gone), false);
  assert.equal(canEditTaxDeadline(deadline('Completed')), true);
  assert.equal(canDeleteTaxDeadline(deadline('Completed')), true);
});

test('due dates round-trip through the date input as UTC days', () => {
  assert.equal(deadlineDateInput({ microsSinceUnixEpoch: BigInt(Date.UTC(2026, 2, 31)) * 1000n }), '2026-03-31');
  assert.equal(deadlineDateInput(null), '');
});

test('an update needs a title, and an empty description is left unchanged', () => {
  assert.equal(toTaxDeadlineUpdateValues({ title: '  ', dueDate: '2026-03-31' }), null);
  assert.deepEqual(toTaxDeadlineUpdateValues({ title: ' VAT ', dueDate: '', description: ' ' }), { title: 'VAT' });
  assert.deepEqual(toTaxDeadlineUpdateValues({ title: 'VAT', dueDate: '2026-03-31', description: 'Q1' }), {
    title: 'VAT',
    dueDate: '2026-03-31',
    description: 'Q1',
  });
});

test('the create body needs a title, a type and a due date and wraps the optional company', () => {
  assert.equal(toTaxDeadlineCreateBody({ title: 'VAT', deadlineType: 'Filing' }), null);
  assert.equal(toTaxDeadlineCreateBody({ title: ' ', deadlineType: 'Filing', dueDate: '2026-03-31' }), null);
  const body = toTaxDeadlineCreateBody({ title: 'VAT', deadlineType: 'Filing', dueDate: '2026-03-31', companyId: '7' });
  assert.deepEqual(body?.company_id, { some: 7 });
  assert.deepEqual(body?.deadline_type, { filing: [] });
  assert.deepEqual(toTaxDeadlineCreateBody({ title: 'VAT', deadlineType: 'Filing', dueDate: '2026-03-31', companyId: '' })?.company_id, {
    none: [],
  });
});

test('the update body wraps a new description as a nested option and leaves it unchanged otherwise', () => {
  assert.equal(toTaxDeadlineUpdateBody({ title: '' }), null);
  assert.deepEqual(toTaxDeadlineUpdateBody({ title: 'VAT', description: 'Q1' })?.description, { some: { some: 'Q1' } });
  assert.deepEqual(toTaxDeadlineUpdateBody({ title: 'VAT' })?.description, { none: [] });
  assert.deepEqual(toTaxDeadlineUpdateBody({ title: 'VAT' })?.title, { some: 'VAT' });
});
