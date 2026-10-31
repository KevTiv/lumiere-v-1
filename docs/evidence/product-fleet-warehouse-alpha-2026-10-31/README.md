# Products, Fleet and Warehouse visual evidence

These are actual browser captures of production presentation components with the same fixed synthetic records. They compare main `8361d7d3b6e204e6629830e0877a04f41a516677` with the candidate source in this change. Both use UTC. They demonstrate presentation and fixture interactions; they do not establish live tenant setup, native persistence or release acceptance.

| Workspace | Annotated comparison | Standalone board | Desktop captures | Narrow captures |
| --- | --- | --- | --- | --- |
| Products | [PNG](products-before-after.png) | [HTML](products-before-after.html) | [Before](products-before-1440.png) · [After](products-after-1440.png) | [Before](products-before-390.png) · [After](products-after-390.png) |
| Fleet | [PNG](fleet-before-after.png) | [HTML](fleet-before-after.html) | [Before](fleet-before-1440.png) · [After](fleet-after-1440.png) | [Before](fleet-before-390.png) · [After](fleet-after-390.png) |
| Warehouse | [PNG](warehouse-before-after.png) | [HTML](warehouse-before-after.html) | [Before](warehouse-before-1440.png) · [After](warehouse-after-1440.png) | [Before](warehouse-before-390.png) · [After](warehouse-after-390.png) |

Each HTML board embeds its source screenshots and uses the Mobbin comparison template. Highlights come from the actual DOM rectangles in [before measurements](before-measurements.json) and [after measurements](after-measurements.json). Warehouse has no baseline stock toolbar, so its new toolbar has an after-only highlight. The board PNGs render the complete board at device scale 2.

The changes use Lumière's existing components and design tokens. Mobbin references inform table identity, nearby filtering and navigation; they do not supply ERP or Fleet business rules. The Warehouse on-hand/count distinction is a source-data correctness fix.

Ten fixture browser cases passed across fresh batches, including all three workspaces at 390px and 1440px. A single full run hit the local memory limit. See the [scope and validation ledger](../../plans/product-fleet-alpha-2026-10-31.md) for exact results, references, test limitations and release gates.
