# Owner skill validation and native harness binding

An organization with one owner must be able to review and activate its own
certified skills. This changes skill promotion only; rollback and independent
knowledge acceptance retain their existing policies.

## Approval policy

- The reducer still requires `ai_skill:write`, an active skill, valid knowledge
  lineage where applicable, and current passing evidence for every fixture.
- An author or reviewer may promote only when their current organization
  membership and effective permissions identify an organization administrator
  through the existing access-lifecycle policy. A skill writer alone cannot
  self-approve. Client role names and version metadata confer no authority.
- Administrator self-approval requires a non-empty validation note. Existing
  independent approvers remain supported. Release history and its audit row
  record actor, version, reason and approval mode.
- AI Skills shows a review dialog containing fixture status, a required note
  and an explicit activation confirmation. Server checks remain authoritative
  if evidence, membership or permissions change while the dialog is open.

## Native version preparation

The default creation flow discovers the running gateway's native adapters and
their actual source hashes and policy templates. The user chooses a separate
semantic skill version and review note. Creation rechecks the discovered
runtime and source; a changed gateway requires another review. It does not
create grants, call a provider, register an executor or assert fixture outcomes.

The metadata discovery route is authenticated at the web BFF and internal-secret
protected at the gateway. It uses the already admitted certification URL with
`view=native-bindings`; ordinary certification GET/POST still reaches the API
server. There is no new public wildcard route.

Supported native validation adapters are report analysis, report composer,
low stock and the five Finance reviews. Unknown implementations remain blocked;
registering arbitrary executable code is outside this flow. The advanced
manifest editor remains available for existing administrative workflows.

Skill minor/patch revisions no longer need an exact compiled skill version.
They use the adapter's supported major version and must still match the exact
executable source hash. A new version on an unchanged adapter can be certified
and activated without a harness build or deployment. A source or runtime change
still requires fresh evidence; previous passes are never silently rebound.
The certification queue already selects and pins the active runtime profile
server-side. The discovered runtime hash in version metadata is provenance,
not an instruction to the executor.

## Validation and rollout

Regression coverage checks administrator self-approval versus ordinary writers,
required notes, compatible skill revisions, incompatible majors, stale executable
hash rejection, canonical manifests, version increments, authenticated discovery,
upstream failure and preservation of the existing certification transport.

After deployment, prepare a new report-analysis version from the running harness,
run its synthetic fixture, review its evidence as the existing owner, activate
it and recheck report readiness. Do not reuse the earlier v1.0.8 pass if its
source/runtime no longer matches the deployed build. This code change alone is
not live acceptance or provider/spend certification.
