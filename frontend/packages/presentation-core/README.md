# Presentation core

`@lumiere/presentation-core` contains renderer-neutral dashboard definitions and
the semantic values bound to them. Definitions contain stable IDs and
translation keys; values contain no UI, transport, or business-policy details.
The TypeScript definitions are the contract; this package deliberately does not
include a runtime parser for administrative payloads.

The initial definition is `overviewDashboardDefinition`. A renderer resolves
translation keys and chooses its own layout, icons, and interaction behavior.

This first slice supports metric groups, numeric series, and scalar report
tables. Series IDs identify data keys; separate localized series legends are
not part of this model yet. `OverviewDashboardData` requires the current
Overview bindings. The web adapter rejects absent bindings and accepts empty
arrays as valid data, so a wiring error cannot silently become an empty chart.

The shared package does not fetch resources or authorize actions. Overview
continues to obtain and calculate values through its existing application
hooks. Admin configuration, persistence, workflow transitions, and WorkProgram
execution remain follow-up work in the coordination plan.
