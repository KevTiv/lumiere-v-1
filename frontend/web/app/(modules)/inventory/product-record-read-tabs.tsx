'use client';

import { useMemo } from 'react';
import { useTranslation } from '@lumiere/i18n';
import type { EntityColumn } from '@lumiere/ui';
import {
  useProductAttributeLines,
  useProductAttributeValues,
  useProductAttributes,
  useProductPackagings,
  useProducts,
  useProductSupplierInfos,
} from '@lumiere/query-hooks/hooks/inventory';
import { useCurrencies } from '@lumiere/query-hooks/hooks/settings';
import { ReadOnlyRows } from '../../../components/read-only-rows';
import { packagingsForProduct, productVariantReferences, variantLinesForTemplate, vendorPricesForTemplate } from './product-record-tabs';

type Row = Record<string, unknown>;

interface ProductReadTabProps {
  orgId: bigint;
  record: Row;
}

export function ProductVariantsTab({ orgId, record }: ProductReadTabProps) {
  const { t } = useTranslation();
  const products = useProducts(orgId);
  const product = products.data?.find((row) => String(row.id) === String(record.id));
  const variants = productVariantReferences((product ?? {}) as Row);
  const lines = useProductAttributeLines(orgId);
  const attributes = useProductAttributes(orgId);
  const values = useProductAttributeValues(orgId);
  const rows = useMemo(
    () =>
      variantLinesForTemplate(
        record.id,
        (lines.data ?? []) as Row[],
        (attributes.data ?? []) as Row[],
        (values.data ?? []) as Row[],
      ),
    [record.id, lines.data, attributes.data, values.data],
  );
  const columns: EntityColumn[] = [
    { key: 'attribute', label: t('inventory.productTabs.variants.attribute', { defaultValue: 'Attribute' }), width: 'min-w-32' },
    { key: 'values', label: t('inventory.productTabs.variants.values', { defaultValue: 'Values' }), width: 'min-w-48' },
    { key: 'valueCount', label: t('inventory.productTabs.variants.valueCount', { defaultValue: 'Count' }), type: 'number', align: 'right' },
  ];
  return (
    <div className="space-y-4">
      <ReadOnlyRows
        id="product-variants-read"
        testId="product-variants-tab"
        columns={[
          { key: 'id', label: t('inventory.productTabs.variants.reference', { defaultValue: 'Variant reference' }) },
        ]}
        rows={variants ?? []}
        isLoading={products.isLoading}
        error={products.error ?? (!variants && !products.isLoading
          ? new Error(t('inventory.productTabs.variants.unavailable', { defaultValue: 'Saved variants are unavailable.' }))
          : undefined)}
        emptyMessage={t('inventory.productTabs.variants.noSaved', { defaultValue: 'No saved variants for this product.' })}
      />
      <div>
        <h3 className="mb-2 text-sm font-medium">{t('inventory.productTabs.variants.attributes', { defaultValue: 'Variant attributes' })}</h3>
        <ReadOnlyRows
          id="product-variant-attributes-read"
          testId="product-variant-attributes-tab"
          columns={columns}
          rows={rows}
          isLoading={lines.isLoading || attributes.isLoading || values.isLoading}
          error={lines.error ?? attributes.error ?? values.error}
          emptyMessage={t('inventory.productTabs.variants.noAttributes', { defaultValue: 'No variant attributes configured.' })}
        />
      </div>
    </div>
  );
}

export function ProductVendorPricesTab({
  orgId,
  record,
  vendorNameById,
}: ProductReadTabProps & { vendorNameById: ReadonlyMap<string, string> }) {
  const { t } = useTranslation();
  const infos = useProductSupplierInfos(orgId);
  const currencies = useCurrencies();
  const rows = useMemo(() => {
    const currencyCodeById = new Map<string, string>();
    for (const currency of (currencies.data ?? []) as Row[]) {
      const code = String(currency.code ?? '').trim();
      if (currency.id != null && code) currencyCodeById.set(String(currency.id), code);
    }
    return vendorPricesForTemplate(record.id, (infos.data ?? []) as Row[], vendorNameById, currencyCodeById);
  }, [record.id, infos.data, currencies.data, vendorNameById]);
  const columns: EntityColumn[] = [
    { key: 'vendor', label: t('inventory.productTabs.vendors.vendor', { defaultValue: 'Vendor' }), width: 'min-w-40' },
    { key: 'vendorProductName', label: t('inventory.productTabs.vendors.productName', { defaultValue: 'Vendor product name' }), width: 'min-w-40' },
    { key: 'vendorProductCode', label: t('inventory.productTabs.vendors.productCode', { defaultValue: 'Vendor code' }) },
    { key: 'minQty', label: t('inventory.productTabs.vendors.minQty', { defaultValue: 'Min qty' }), type: 'number', align: 'right' },
    { key: 'price', label: t('inventory.productTabs.vendors.price', { defaultValue: 'Price' }), type: 'number', align: 'right' },
    { key: 'currency', label: t('inventory.productTabs.vendors.currency', { defaultValue: 'Currency' }) },
    { key: 'delay', label: t('inventory.productTabs.vendors.delay', { defaultValue: 'Lead time (days)' }), type: 'number', align: 'right' },
    { key: 'dateStart', label: t('inventory.productTabs.vendors.validFrom', { defaultValue: 'Valid from' }), type: 'date' },
    { key: 'dateEnd', label: t('inventory.productTabs.vendors.validUntil', { defaultValue: 'Valid until' }), type: 'date' },
  ];
  return (
    <ReadOnlyRows
      id="product-vendor-prices-read"
      testId="product-vendor-prices-tab"
      columns={columns}
      rows={rows}
      isLoading={infos.isLoading}
      error={infos.error}
      emptyMessage={t('inventory.productTabs.vendors.empty', { defaultValue: 'No vendor prices for this product.' })}
    />
  );
}

export function ProductPackagingTab({ orgId, record }: ProductReadTabProps) {
  const { t } = useTranslation();
  const packagings = useProductPackagings(orgId);
  const rows = useMemo(() => packagingsForProduct(record.id, (packagings.data ?? []) as Row[]), [record.id, packagings.data]);
  const columns: EntityColumn[] = [
    { key: 'name', label: t('inventory.productTabs.packaging.name', { defaultValue: 'Packaging' }), width: 'min-w-40' },
    { key: 'qty', label: t('inventory.productTabs.packaging.qty', { defaultValue: 'Contained quantity' }), type: 'number', align: 'right' },
    { key: 'barcode', label: t('inventory.productTabs.packaging.barcode', { defaultValue: 'Barcode' }) },
    { key: 'sales', label: t('inventory.productTabs.packaging.sales', { defaultValue: 'Sales' }), type: 'boolean' },
    { key: 'purchase', label: t('inventory.productTabs.packaging.purchase', { defaultValue: 'Purchase' }), type: 'boolean' },
    { key: 'weight', label: t('inventory.productTabs.packaging.weight', { defaultValue: 'Weight' }), type: 'number', align: 'right' },
    { key: 'volume', label: t('inventory.productTabs.packaging.volume', { defaultValue: 'Volume' }), type: 'number', align: 'right' },
  ];
  return (
    <ReadOnlyRows
      id="product-packaging-read"
      testId="product-packaging-tab"
      columns={columns}
      rows={rows}
      isLoading={packagings.isLoading}
      error={packagings.error}
      emptyMessage={t('inventory.productTabs.packaging.empty', { defaultValue: 'No packaging defined for this product.' })}
    />
  );
}
