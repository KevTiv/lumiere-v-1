# Presentation core

`@lumiere/presentation-core` contains renderer-neutral dashboard definitions and
the semantic values bound to them. Definitions contain stable IDs and
translation keys; values contain no UI, transport, or business-policy details.
The static dashboard definitions are authored in TypeScript. Runtime module
drafts use a separate Rust-owned contract, described below.

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

## Module draft contract

Import `ModuleDraft` from `@lumiere/presentation-core/module-contract`. These
types are generated from `crates/presentation-core` through checked-in Draft 7
JSON Schema. Run `pnpm generate:contract` from this package to update both
artifacts, and `pnpm check:contract` to verify them. CI independently checks the
Rust/schema and schema/TypeScript edges.

The authenticated Rust API exposes `GET /v1/presentation/capabilities` and
`POST /v1/presentation/validate`. Discovery returns actor-filtered SQL column
identifiers, reviewed annotations, the contract pin, and component versions.
Submit the complete module draft to obtain diagnostics. Client types do not
replace server parsing, policy filtering, or validation.

These endpoints support draft diagnostics only. A valid draft is not a saved,
published, executable, or authorized module. `baseRevision` is checked for wire
format, not persistence conflicts. `pageSize` is a planned rendering/acquisition
constraint; the existing account-moves query is not paginated by this work.
The future runtime must translate SQL column bindings through canonical DTO
metadata and provide bounded reads before enabling the collection host.
