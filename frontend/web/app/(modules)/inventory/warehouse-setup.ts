import { parseStrictU64 } from '@lumiere/erp-shared/u64';
import type { ModuleDataState } from '@lumiere/ui/lib/module-data-state';
import type { ModuleConfig } from '@lumiere/ui/lib/module-types';
import type { EntityRow as Row } from '@lumiere/ui/lib/entity-view-types';

const field = (row: Row, camel: string, snake: string) => Object.hasOwn(row, camel) ? row[camel] : row[snake];
const hasField = (row: Row, camel: string, snake: string) => Object.hasOwn(row, camel) || Object.hasOwn(row, snake);
const id = (value: unknown) => {
  const parsed = parseStrictU64(value);
  return parsed != null && parsed > 0n ? parsed.toString() : null;
};

export type WarehouseSetupStatus = 'company-required' | 'loading' | 'unavailable' | 'locations-required' | 'assisted-setup' | 'ready';

/** Only readable, active templates in the selected company may supply operational references. */
export function warehouseSetup(input: {
  organizationId: unknown;
  companyId: unknown;
  warehouses: readonly Row[];
  locations: readonly Row[];
  warehouseState: ModuleDataState;
  locationState: ModuleDataState;
}): { status: WarehouseSetupStatus; templates: readonly Row[] } {
  const organizationId = id(input.organizationId);
  const companyId = id(input.companyId);
  if (!organizationId || !companyId) return { status: 'company-required', templates: [] };
  const states = [input.warehouseState, input.locationState];
  if (states.some(state => ['denied', 'error', 'partial'].includes(state.status))) {
    return { status: 'unavailable', templates: [] };
  }
  if (states.some(state => state.status === 'loading')) return { status: 'loading', templates: [] };
  const locationScopeUnreadable = input.locations.some(row =>
    field(row, 'organizationId', 'organization_id') === undefined ||
    !hasField(row, 'companyId', 'company_id') || row.active === undefined || row.usage === undefined,
  );
  const warehouseScopeUnreadable = input.warehouses.some(row =>
    field(row, 'organizationId', 'organization_id') === undefined ||
    field(row, 'companyId', 'company_id') === undefined || row.active === undefined,
  );
  if (locationScopeUnreadable || warehouseScopeUnreadable) return { status: 'unavailable', templates: [] };
  const locations = input.locations.filter(row =>
    id(field(row, 'organizationId', 'organization_id')) === organizationId &&
    (field(row, 'companyId', 'company_id') == null || id(field(row, 'companyId', 'company_id')) === companyId) && row.active === true,
  );
  const stockLocations = locations.filter(row => row.usage === 'internal');
  if (stockLocations.length === 0) return { status: 'locations-required', templates: [] };
  const locationIds = new Set(locations.map(row => id(row.id)));
  const stockLocationIds = new Set(stockLocations.map(row => id(row.id)));
  if (input.warehouses.some(row =>
    id(field(row, 'organizationId', 'organization_id')) === organizationId &&
    id(field(row, 'companyId', 'company_id')) === companyId && row.active === true &&
    (field(row, 'lotStockId', 'lot_stock_id') === undefined || ['in', 'out', 'int', 'pack', 'pick'].some(prefix =>
      field(row, `${prefix}TypeId`, `${prefix}_type_id`) === undefined,
    )),
  )) return { status: 'unavailable', templates: [] };
  const templates = input.warehouses.filter(row =>
    id(field(row, 'organizationId', 'organization_id')) === organizationId &&
    id(field(row, 'companyId', 'company_id')) === companyId && row.active === true &&
    stockLocationIds.has(id(field(row, 'lotStockId', 'lot_stock_id'))) &&
    // Operation types are codes in the current model, not a separate readable table.
    ['in', 'out', 'int', 'pack', 'pick'].every(prefix =>
      id(field(row, `${prefix}TypeId`, `${prefix}_type_id`)) !== null,
    ) &&
    [
      ['whInputStockLocId', 'wh_input_stock_loc_id'],
      ['whOutputStockLocId', 'wh_output_stock_loc_id'],
      ['whPackStockLocId', 'wh_pack_stock_loc_id'],
      ['whQcStockLocId', 'wh_qc_stock_loc_id'],
      ['whScrapLocId', 'wh_scrap_loc_id'],
      ['viewLocationId', 'view_location_id'],
    ].every(([camel, snake]) => {
      const value = field(row, camel!, snake!);
      return value == null || locationIds.has(id(value));
    }),
  );
  return { status: templates.length ? 'ready' : 'assisted-setup', templates };
}

/** An unavailable template must not open a form that cannot be submitted. */
export function withWarehouseSetup(config: ModuleConfig, ready: boolean): ModuleConfig {
  if (ready) return config;
  return { ...config, tabs: config.tabs.map(tab => tab.id !== 'warehouses' ? tab : {
    ...tab, createAction: undefined, createForm: undefined, createLabel: undefined,
  }) };
}
