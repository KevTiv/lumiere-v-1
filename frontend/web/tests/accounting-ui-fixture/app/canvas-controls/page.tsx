"use client";

import { useState } from "react";
import { I18nProvider } from "@lumiere/i18n";
import { CanvasWorkspace } from "@lumiere/ui/composed/canvas-workspace";
import { StockSearchBar } from "@lumiere/ui/stock-3d/stock-search-bar";
import { StockSidebar } from "@lumiere/ui/stock-3d/stock-sidebar";
import { Warehouse3DProvider } from "@lumiere/ui/stock-3d/warehouse-3d-context";
import { ItemDetailsPanel } from "@lumiere/ui/stock-3d/item-details-panel";
import type { StockItem } from "@lumiere/stdb/warehouse-3d";

const items: StockItem[] = [{
  id: "coffee-1",
  name: "Coffee beans",
  sku: "COF-001",
  category: "food",
  zoneId: "zone-1",
  slotId: "slot-1",
  quantity: 2,
  minStock: 3,
  lastUpdated: new Date("2026-10-30T08:30:00Z"),
}];

export default function Page() {
  const [compact, setCompact] = useState(false);

  return (
    <I18nProvider language="en">
      <main className="min-w-0 p-4">
        <button type="button" onClick={() => setCompact(!compact)} className="mb-2">
          {compact ? "Widen workspace" : "Narrow workspace"}
        </button>
        <div
          className="h-80 w-full min-w-0 border"
          style={{ maxWidth: compact ? 360 : 1000 }}
          data-testid="canvas-fixture"
        >
          {/* Production controls and state with a GPU-independent canvas placeholder. */}
          <Warehouse3DProvider zones={[]} slots={[]} items={items}>
            <CanvasWorkspace
              side="left"
              toolbar={<StockSearchBar />}
              controls={<StockSidebar />}
              controlsLabel="Stock controls"
              controlsTitle="Stock Overview"
            >
              <div className="min-h-0 flex-1 bg-muted" data-testid="canvas-placeholder" />
              <ItemDetailsPanel className="max-h-[45%] min-w-0 shrink-0 overflow-y-auto" />
            </CanvasWorkspace>
          </Warehouse3DProvider>
        </div>
      </main>
    </I18nProvider>
  );
}
