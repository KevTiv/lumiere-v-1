import { variantTag } from '@lumiere/erp-workflows';
import {
  accountingParamsToJson,
  toCreateTaxDeadlineParams,
  toUpdateTaxDeadlineParams,
} from '@lumiere/erp-shared/accounting-create-params';
import { compatNumberToDate, stdbTimestampToDate } from '@lumiere/erp-shared/timestamp-values';

type Row = Record<string, unknown>;

const OPEN_STATUSES = new Set(['Upcoming', 'DueSoon', 'Overdue']);

function isDeleted(deadline: Row): boolean {
  return (deadline.deletedAt ?? deadline.deleted_at) != null;
}

/** A deadline still awaiting action: not completed, waived or deleted. */
export function taxDeadlineIsOpen(deadline: Row): boolean {
  return !isDeleted(deadline) && OPEN_STATUSES.has(variantTag(deadline.status));
}

/**
 * `complete_tax_deadline` (tax_deadline:write) rejects deleted and already completed deadlines;
 * the action is only offered while the deadline is open.
 */
export function canCompleteTaxDeadline(deadline: Row): boolean {
  return taxDeadlineIsOpen(deadline);
}

/** `waive_tax_deadline` (tax_deadline:admin) marks an open deadline as not applicable. */
export function canWaiveTaxDeadline(deadline: Row): boolean {
  return taxDeadlineIsOpen(deadline);
}

/** `update_tax_deadline` (tax_deadline:write) rejects deleted deadlines. */
export function canEditTaxDeadline(deadline: Row): boolean {
  return !isDeleted(deadline);
}

/** `delete_tax_deadline` (tax_deadline:delete) soft-deletes; a deleted deadline has nothing left to delete. */
export function canDeleteTaxDeadline(deadline: Row): boolean {
  return !isDeleted(deadline);
}

/** A reducer timestamp (or legacy number) as the `YYYY-MM-DD` a date input holds; '' when unreadable. */
export function deadlineDateInput(value: unknown): string {
  const date = stdbTimestampToDate(value) ?? compatNumberToDate(value);
  return date == null ? '' : date.toISOString().slice(0, 10);
}

/**
 * Form values for `update_tax_deadline`. The reducer cannot clear a description (an empty
 * description means "no change"), so the key is only sent when text was entered.
 */
export function toTaxDeadlineUpdateValues(values: Row | null | undefined): Row | null {
  if (values == null) return null;
  const title = String(values.title ?? '').trim();
  if (title === '') return null;
  const out: Row = { title };
  const dueDate = String(values.dueDate ?? '').trim();
  if (dueDate !== '') out.dueDate = dueDate;
  const description = String(values.description ?? '').trim();
  if (description !== '') out.description = description;
  return out;
}

/** Reducer body for `create_tax_deadline`; null unless a title, a type and a due date are given. */
export function toTaxDeadlineCreateBody(values: Row | null | undefined): Record<string, unknown> | null {
  if (values == null) return null;
  const params = toCreateTaxDeadlineParams(values);
  return params == null ? null : accountingParamsToJson(params, 'CreateTaxDeadlineParams');
}

/**
 * Reducer body for `update_tax_deadline`; null without a title. `description` is an
 * `Option<Option<String>>`, which the generic encoder wraps only once, so it is wrapped again here.
 */
export function toTaxDeadlineUpdateBody(values: Row | null | undefined): Record<string, unknown> | null {
  const input = toTaxDeadlineUpdateValues(values);
  if (input == null) return null;
  const body = accountingParamsToJson(toUpdateTaxDeadlineParams(input), 'UpdateTaxDeadlineParams');
  const description = body.description;
  if (description != null && typeof description === 'object' && 'some' in description) {
    body.description = { some: description };
  }
  return body;
}
