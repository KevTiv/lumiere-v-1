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

Import `ModuleDraft` from `@lumiere/presentation-core/module-contract` (and the
preview types from `./preview-contract`). Both re-export the released
`@lumiere/contracts/presentation/*` contracts. The Draft 7 JSON Schemas and
TypeScript types are generated from `crates/presentation-core` by
`make generate-presentation-contracts` and shipped in a contracts release; the
schemas are also exposed to Rust as `lumiere_contracts::manifests::PRESENTATION_*`.
Contracts drift and the Rust schema test fail when the models change without a
new release.

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

## Personal layouts for existing pages

`@lumiere/presentation-core/personal-page-layout` exports the Rust-generated
`PersonalPageLayout` model and request/response validators. Its module enum is
the shared inventory for business page hosts and assistant page actions.

A layout is a complete ordered list of placements. Each placement has its own
`id`, a `builtin` or `saved` source, a reusable `widgetId`, and a twelve-column
width of `3`, `4`, `6`, `8`, or `12`. Moving or resizing a saved chart changes
only its placement on this page. Saved dashboard widget definitions retain
their existing metric configuration and read authorization. A builtin appears
once per page; a saved chart can have multiple independent placements.

The authenticated API exposes `GET` and `PUT`
`/v1/presentation/pages/:moduleId/:pageId?companyId=<decimal>`. A PUT contains
`{ expectedRevision: string | null, layout: PersonalPageLayout | null }`.
Both fields must be present. The response includes `companyId`, `moduleId`,
`pageId`, `revision`, and `layout`; identities and revisions retain exact decimal
strings. A null layout appends a reset revision that uses the host's defaults.
An unsaved page has both a null revision and a null layout.

Each save uses the authenticated organization and actor plus the validated
company, module and page. Native persistence reuses the immutable presentation
head/version tables under the reserved `personal-page:` namespace. Expected
revisions prevent lost edits; an immediate identical retry returns the same
revision without duplicate audit or commit rows. A conflicting edit returns
HTTP 409 and must be reloaded before saving again. Limits are 64 widgets per
page, 512 personal pages per owner, and 1,024 immutable versions per page.

Personalization requires current module read access and a unique active
membership. Company selection follows the existing API policy: bound members
use their company, while organization-wide members and current explicit
wildcard roles may select another active company in the organization. Module
deny rules still apply to wildcard roles. Saved references also require read
access to the active widget and its source model. GET returns the owner's inert
references so an unavailable widget can be removed; the live renderer authorizes
data reads independently.

The dedicated `save_personal_page_layout` reducer remains denied to generic
operation dispatch. The API admits only its fixed released signature. Release
and pin the generated contracts, then deploy the matching native module and
API, before enabling saves; an older contract pin returns HTTP 503. Generic
module publication and activation retain their existing disabled gate.
