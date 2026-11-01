# Product category update option encoding

Task / base SHA

Repair the category rename request found during live farm acceptance. Base:
`04d8541e4d4cfea61bcf5af4144ab054f33eb878`. The observed served revision was
`4b6f045a565eb9e4e0fe6496e600db409379292a`; the final main source retained
the same defective serialization call. This record describes a source fix.

Files changed

The query-hook category update paths select the existing native parameter
schema through `productCategoryUpdateParams`. The category regression tests
exercise that same request parameter builder.

Before path

Products Categories / Rename category submits `useRenameProductCategory`.
The hook calls `stdbBffCommandPost('update_product_category', ...)`, but its
`stdbParamsToJson` call omits `UpdateProductCategoryParams`. The trusted API
dispatch therefore passes a plain name string. The native module rejects the
argument: it requires a SATS option sum. The form retains its input and canonical
category readback confirms that the saved name did not change.

After path

Both the rename hook and existing general category update hook select the
generated `UpdateProductCategoryParams` option map. The name is encoded as
`{ some: value }`; omitted parent, sequence and metadata fields are encoded as
`{ none: [] }`. The native update owner retains those omitted values.

Canonical owners reused

Existing generated parameter map, immutable named operation transport, trusted
API dispatch, native `update_product_category` reducer and category query.

Effect identity + cardinality

Exactly one existing category ID. The rename resolver retains its exact
pre-read/post-read and idempotent retry behavior. No replacement category or
product relinking is added.

Resulting record ref

No record was created or changed by this source repair. The failed production
attempt and exact record/request identities are saved privately outside Git.

Typed outcomes/errors

Only the parameter encoding changes. An unreadable or unconfirmed saved name
still fails without a success toast or automatic redispatch.

Tests run (command + result)

- Category regression with the old schema-less encoder: fails on the plain
  string versus option-sum request body.
- `node --import <cached-tsx-loader> --test frontend/packages/stdb/src/stdb-params-json.test.ts frontend/packages/query-hooks/src/hooks/product-category-rename.test.ts`:
  66 passed, zero failed. The helper imports this checkout's serializer and
  generated option maps through an ignored local workspace link.
- `git diff --check`: passed.

Operator proof

The live pre-fix UI request failed, retained the edited name and did not change
the exact saved category. A successful deployed retry and refreshed category
and product-link readback remain required. No direct reducer mutation substitutes
for that operator proof.

Compatibility/debt retired

Removes the untyped category parameter encoding at both update call sites.
No native signature, generated map or immutable contract changes.

Remaining blocker/deferral

Current-head hosted checks, merge/release and deployed rename acceptance remain
pending. Other farm acceptance uses the separately released main revision.

Contract release required: no

Next bounded task

After deployment, read the exact saved category, submit once through Products,
refresh, and confirm the same category ID, parent, sequence, metadata and product
links. Keep original source files and business records unchanged.
