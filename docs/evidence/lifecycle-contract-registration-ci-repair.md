# Lifecycle contract registration CI repair

Base: PR #344 at 3222443cc. This candidate fixes the operation identity error
from CI run 41231404140. It is source preparation, not a published contract.

The five lifecycle views now have stable erp operation IDs and internal,
non-client-facing classifications. The supported SDK wrappers regenerated the
HTTP option metadata. The generator now completes instead of rejecting the
new views. No generated binding was edited manually.

Validation uses the exact successful CI module artifact 13054501160, ZIP SHA256
ccb79e95d6212fff1545944f7518360767b65c31fde5e71a61f5b02a72e364c2.
The module ran only in a disposable loopback database. Generated IR validates
with 1,496 operations, 373 resources and 524 tables. Codegen tests: 141 passed,
one ignored. Operation-history tests: 17 passed. Agent capability validation
passed. Full native reader authorization and deployed acceptance remain separate.

The history records five added operations. Inserting the new views also changes
six existing view allocation indexes. A structural comparison after normalizing
type references and removing only the allocation index proves that their targets,
parameters and named return types are unchanged. Existing revision entries remain
intact. No table, released migration or application catalog entry changed.

The candidate IR and its history agree. The release compatibility check against
the still-pinned v0.3.159 artifact does not pass: it contains the older view
indexes and lacks the new views. Publication and consumer pin alignment are
required to complete the drift repair; those checks have not been weakened.

This review branch uses the existing codex/draft-backend-* exclusion in
.github/workflows/release-contracts.yml. Pushing it does not publish a contract.
Applying it to PR #344's branch triggers the normal Release contracts workflow,
which publishes the next free immutable version and pins that branch. That step
requires release approval. No Railway deployment is included or performed.
