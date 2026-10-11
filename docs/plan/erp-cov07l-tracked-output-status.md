# COV-07L — Explicit tracked output and manufacturing waste

Producer implementation adds three intents without changing existing reducer
inputs or table layouts:

- `finish_manufacturing_order_with_tracking`: closes through the same MO,
  workorder, quality and cost validation as the existing finish operation.
  Primary lot/serial and BOM-byproduct lot/serial identities are explicit.
  Every identity must match organization, company, product and stock identity;
  locked/expired identities, duplicate byproduct attribution, unrelated BOM
  rows and already-posted serials are rejected before output posting.
- `scrap_tracked_manufacturing_output`: selects an exact completed output move
  in `move_finished_ids`, including byproducts. It inherits that move's lot or
  serial, bounds cumulative scrap by its quantity, relocates the exact available
  quant and marks a scrapped serial at the scrap location. The durable effect
  records `production_id` and `source_output_move_id`; reused request references
  are rejected without a second effect.
- `scrap_manufacturing_material`: records additional wastage of available BOM
  raw stock during `Progress`, before material consumption. The source quant
  must match organization/company, MO source location and an authoritative
  BOM-owned component. The durable move is attributed to the MO via both
  production identities and records its exact source quant. Wastage leaves the
  original BOM consumption requirement intact. Availability limits prevent
  disposing of reserved or insufficient stock.

The tracked producer is layered on manufacturing actual costing: output move
cost allocation and metadata remain intact, and output quants retain their
explicit lot identity. No generated contracts are manually edited. Authored
operation classifications and reducer exposure entries cover the new producer
intents and the denied runtime test reducer. A canonical generated contract
release must include these operations and both parameter structs before a UI
consumer can call them.

## Proof and acceptance

`spacetimedb/tests/manufacturing/tracked_output_test.rs` defines
`run_manufacturing_tracked_output_test`. It exercises lot-primary and
serial-byproduct close, exact lot conservation, exact serial scrap placement,
duplicate/foreign/locked attribution rejection, fractional and excessive scrap,
replayed close/scrap, and in-progress material waste followed by unchanged BOM
consumption. Parent integration must register the module in the manufacturing
suite and execute it in the published runtime. The new test parses with rustfmt;
full compile and runtime results remain the responsibility of integrated
acceptance and are not claimed here.

## Explicit limits

- Serial output supports one explicit serial and quantity one per output move.
  Multi-unit serial production requires a split-output contract, rather than
  arbitrary serial selection.
- Serial material wastage is rejected because the existing material-consumption
  contract cannot specify a serial. Lot material wastage can relocate a selected
  source lot, but normal material consumption still requires its own future
  attributed-input contract for tracked components.
- In-progress wastage is disposal of available, unconsumed material. There is
  no posted WIP output inventory to scrap during production; finished quantities
  post at close. True WIP-output scrap requires separate quantity/valuation
  semantics and is not represented by reducing `qty_produced`.
- Ambiguous same-identity quants are rejected. Multiple FIFO/LIFO source layers
  need a layer-aware disposal contract before they can be scrapped together.
- These producers require explicit UI attribution controls after contract
  publication; existing untracked UI remains available. Producer implementation
  alone is not evidence of browser acceptance or module promotion.

## Bounded operator controls

The MO record page now includes `ManufacturingTrackingPanel` for explicit
attributed close, exact completed tracked-output scrap and available BOM-material
wastage. Selectors derive from authoritative BOM ownership and scoped reference
rows. They reject other organizations/companies/products, missing/ambiguous
references, locked identities, previously placed serials, unsupported serial
quantities, fractional serial scrap, excessive output/material quantities and
inconsistent existing waste effects. Nothing is selected automatically.

The panel calls generated named operations and uses cache-independent canonical
readback before showing record links. Close readback checks every owned output
against its exact reference/product/lot/serial; scrap readback checks request,
source output or quant, quantity and destination. Unknown outcomes retain the
request identity; an in-flight guard prevents multiple concurrent dispatches.
Failed reference queries remain visible and block submission.

Eight focused intent/readback tests pass using Node's TypeScript stripping with
an alias-resolution loader; `git diff --check` passes. Integrated typecheck needs
the canonical generated contract release containing these operations. Browser
acceptance remains pending: these test results prove selector/intent/readback
logic, not a browser run. Multiunit serial close remains excluded explicitly.
