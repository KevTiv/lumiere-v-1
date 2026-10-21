import { variantTag } from '@lumiere/erp-workflows';

type Row = Record<string, unknown>;

/**
 * `confirm_stock_package` accepts only a draft package and rejects one with no moves. A row that
 * does not carry its move list is left to the reducer to judge.
 */
export function canConfirmPackage(pkg: Row): boolean {
  if (variantTag(pkg.state).toLowerCase() !== 'draft') return false;
  const moves = pkg.moveIds ?? pkg.move_ids;
  return !Array.isArray(moves) || moves.length > 0;
}

/** `done_stock_package` accepts only a confirmed package. */
export function canDonePackage(pkg: Row): boolean {
  return variantTag(pkg.state).toLowerCase() === 'confirmed';
}
