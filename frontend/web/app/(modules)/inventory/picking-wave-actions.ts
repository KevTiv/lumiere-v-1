import { variantTag } from '@lumiere/erp-workflows';

type Row = Record<string, unknown>;

/**
 * `release_picking_wave` rejects a done or cancelled wave and a wave with no pickings. A row that
 * does not carry its picking list is left to the reducer to judge.
 */
export function canReleaseWave(wave: Row): boolean {
  const state = variantTag(wave.state).toLowerCase();
  if (state === '' || state === 'done' || state === 'cancelled' || state === 'cancel') return false;
  const pickings = wave.pickingIds ?? wave.picking_ids;
  return !Array.isArray(pickings) || pickings.length > 0;
}
