import { saleOrderDetailConfig } from '@lumiere/ui';

type OrderRow = Record<string, unknown>;

/** Where an order's page lives. */
export function saleOrderRecordHref(order: OrderRow): string | undefined {
  return order.id == null ? undefined : `/sales/orders/${String(order.id)}`;
}

/** Overview sections of a sale order, with the customer shown by name rather than id. */
export function saleOrderDetailWithPartners(
  t: Parameters<typeof saleOrderDetailConfig>[0],
  partnerLabelById: ReadonlyMap<string, string>,
) {
  const baseDetail = saleOrderDetailConfig(t);
  return {
    ...baseDetail,
    sections: baseDetail.sections.map((section) =>
      section.id === 'customer'
        ? {
            ...section,
            fields: section.fields.map((field) =>
              field.key === 'partnerName'
                ? {
                    ...field,
                    render: (_value: unknown, record: OrderRow) => {
                      const direct = String(record.partnerName ?? record.partner_name ?? '').trim();
                      if (direct) return direct;
                      const partnerId = record.partnerId ?? record.partner_id;
                      if (partnerId == null) return '—';
                      return partnerLabelById.get(String(partnerId)) ?? `Partner ${String(partnerId)}`;
                    },
                  }
                : field,
            ),
          }
        : section,
    ),
  };
}

/** Saves the order and its lines as a JSON file for hand-off to fiscal tooling. */
export function downloadCommercialPacket(order: OrderRow, lines: OrderRow[]): void {
  const orderId = String(order.id ?? '');
  const packet = {
    documentType: 'commercial_invoice_packet',
    generatedAt: new Date().toISOString(),
    order,
    lines,
    note: 'Fiscal submit remains a worker/procedure; this packet is export data only.',
  };
  const blob = new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `commercial-packet-SO-${orderId}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Lines that belong to one order, however the projection spells the foreign key. */
export function linesOfOrder(lines: ReadonlyArray<OrderRow>, orderId: string): OrderRow[] {
  return lines.filter((line) => String(line.orderId ?? line.order_id ?? '') === orderId);
}
