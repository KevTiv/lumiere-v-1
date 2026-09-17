// Public E2E helper facade.
//
// Keep the broad historical helper implementation isolated so correctness-
// sensitive helpers can override weak legacy discovery without duplicating the
// rest of the test utility surface.
export * from "./helpers-legacy"

// COV-01d: this explicit export overrides the historical newest-row/partner
// fallback implementation. All specs importing `./helpers` now get exact
// opportunity relation + 0..1 cardinality semantics.
export {
  fetchSaleOrderIdByOpportunityId,
  fetchSaleOrderIdsByOpportunityId,
} from "./helpers-exact-sale-order"
