# Nested company-scope metadata

`lumiere-codegen/company-scope-metadata.json` is the small, hand-authored
annotation source for company provenance that is not currently derivable from
the reducer's top-level scope positions. It intentionally does not repeat
organization positions from the generated reducer contract.

Paths are rooted at the named operation request and use canonical schema
snake_case. A generated TypeScript client may render `company_id` as
`companyId`, but that spelling should be derived by the emitter rather than
duplicated in this file.

The representative paths are:

| Reducer | Company path | Semantics |
| --- | --- | --- |
| `create_contact` | `params.company_id` | Optional selected legal entity; if present it must belong to the authenticated organization. |
| `create_lead` | none | `CreateLeadParams` has no `company_id`; `company_name` and `partner_id` are ordinary inputs and must not become implicit scope. |
| `create_opportunity` | `params.company_id` | Optional selected legal entity; if present it must belong to the authenticated organization. |
| `delete_company` | `company_id` | Required company target; the server must validate that it belongs to the authenticated organization before dispatch. |

Security invariants enforced by the generated contract and dispatcher:

1. `organization_id` is always session-derived. A client-supplied value is not
   accepted as an override.
2. `company_id` remains client-selectable, but every annotated value is checked
   against the session organization. This is authorization, not merely type
   validation.
3. An absent or nullable `create_contact.params.company_id` must not be filled
   from a default company unless that behavior is explicitly added to the
   operation contract.
4. IDs such as `contact_id`, `customer_id`, and `partner_id` remain ordinary
   domain inputs; their names do not imply company scope.

`lumiere-codegen/tests/test_company_scope_metadata.py` validates the metadata
shape and, when the canonical IR is available, cross-checks the representative
type and top-level scope definitions. The reducer manifest retains these paths
as references to canonical input parameters; api-server performs membership
checks before dispatch.
