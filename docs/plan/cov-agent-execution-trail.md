# COV agent execution trail

**Status:** REQUIRED HANDOFF PROTOTYPE  
**Purpose:** prevent module workers from satisfying a task locally while weakening Lumière's shared contracts, effect certainty or T0 quality bar.

This trail is for COV-01+ module work. It supplements the COV ledger; it does not replace domain plans, COH authority semantics, generated contracts or ADV invariants.

## 1. Work starts with evidence, not code

Every assignment must include this card before a worker edits files:

```text
COV ID + bounded slice
accepted base SHA
module + current U-level evidence
operator workflow step being changed
source route/component
source hook/application service
canonical operation ID/reducer
stable effect identity
canonical readback resource
expected resulting record ref
current authorization/company scope owner
required tests
known defects/dependencies
reserved shared files
forbidden scope
```

If any of `canonical operation`, `stable effect identity`, `readback resource`, or `authority owner` is unknown, the task is investigation-only until resolved.

## 2. Required trace before implementation

A worker writes the current path in the return or task notes:

```text
user click/form
→ component handler
→ query/application hook
→ generated command input
→ operation endpoint
→ server trusted context
→ STDB operation
→ changed canonical resources
→ exact result identity
→ readback/navigation
```

For every arrow, give the concrete file/function. “The frontend calls the backend” is not sufficient evidence.

## 3. Hard stop conditions

Stop and return to the coordinator rather than improvising when any of these occurs:

1. The required operation is absent from the accepted immutable contract/IR.
2. The business effect cannot be identified by an exact stable relationship/idempotency key.
3. More than one canonical row can represent the intended single effect.
4. Result correlation requires “latest/newest row”, matching only by customer/name/amount/date, or timing guesses.
5. The change needs STDB schema/operation signature/generated IR changes but the worker was not assigned the producer/release lane.
6. A shared error/outcome/record-ref type is missing and adding a module-local version would create another authority.
7. The browser would have to provide organization, role, permission, region, reducer, SQL or other authority data.
8. Primary lifecycle proof requires direct reducer calls because the operator action is not actually wired.
9. A permission/approval rule is unclear or conflicts with current server/Casbin behavior.
10. The first-org exposure status of the surface is not classified.
11. Required seed/persona data cannot be created reproducibly.
12. An existing failing invariant is discovered outside the assigned slice; record it, do not mask it with a fallback.

## 4. Forbidden implementation shortcuts

Agents must not introduce or preserve these on a migrated path:

```text
ORDER BY id DESC as effect identity
choose newest/latest row after mutation
partner/name/amount/date heuristic result matching
setTimeout/sleep as correctness
blind retry after unknown consequential effect
new useMutation<void> for a cross-module lifecycle transition
component string parsing of HTTP errors
"Saved" toast from Promise<void> / HTTP 2xx alone
direct /compat/reducer use when generated operation exists
client-provided organization/role/permission authority
module-local business state machine duplicating STDB
repository-wide invalidateQueries() as a substitute for result identity
catch-and-ignore critical persistence/effect errors
direct database/reducer setup in an E2E claimed as operator-path U5 proof
marking U4/U5 from route presence, CRUD forms, unit tests, or domain tests alone
editing generated contract output by hand
creating a sibling renderer/command/error/outcome registry to avoid shared ownership
```

## 5. Preferred implementation sequence

### Step A — prove the exact effect

Before mutation code, identify the stable source→result relation and test zero/one/multiple matches.

Example:

```text
source: Opportunity.id
result: SaleOrder
identity: SaleOrder.opportunity_id == Opportunity.id
cardinality: 0..1
```

Multiple matches are a failing invariant, not an array to sort.

### Step B — preserve generated input authority

Use the accepted generated named operation contract and server-injected organization scope. Finalizers may normalize UI values into generated types; they may not redefine operation structure.

### Step C — return semantic effect result

For consequential/cross-module actions:

```text
pre-read exact effect
→ AlreadyApplied if present
→ dispatch once
→ canonical readback
→ Applied(recordRef) | Rejected(typed error) | OutcomeUnknown
```

Do not call transport acknowledgement `Applied`.

### Step D — invalidate only documented affected resources

Use generated/reviewed resource relationships. Result navigation comes from the returned record ref, not from cache timing.

### Step E — wire UI truthfully

The UI handles semantic states explicitly. Pending/unknown/rejected must not collapse into success.

### Step F — prove browser workflow

Drive the actual visible action from the first-org persona. Follow resulting record links and verify canonical state after refresh/reconnect.

## 6. Agent verification checklist

A worker cannot return “done” without answering each applicable item:

```text
[ ] Generated operation used; no raw reducer-name authority added
[ ] Org/company/actor scope remains server/current-policy derived
[ ] Stable effect identity documented
[ ] Zero/one/multiple effect tests exist
[ ] Idempotent replay behavior is explicit
[ ] Unknown outcome cannot auto-resend
[ ] Typed expected errors reach the caller
[ ] Canonical result ref reaches UI/navigation
[ ] Invalidation list is bounded and explained
[ ] No latest/newest/fallback identity heuristic
[ ] No direct reducer in the primary Playwright path
[ ] Refresh/reopen reads durable state
[ ] Tenant/permission/stale/duplicate cases covered as applicable
[ ] Deferred UI remains hidden rather than half-wired
[ ] No generated file edited manually
[ ] Tests actually run are listed verbatim
```

Unchecked items require a blocker/deferral reason; they are never silently omitted.

## 7. Required return format

Every COV worker returns:

```text
Task: COV-xx[a]
Base SHA:
Files changed:

Before:
  concrete old call/effect path

After:
  concrete new call/effect path

Canonical owners reused:
  operation contract:
  business transition:
  authorization:
  result/readback:
  shared outcome/error:

Effect identity:
  source key:
  result resource:
  cardinality:
  replay behavior:

Tests run:
  command → result

Operator proof:
  user action → resulting record/readback

Compatibility/debt retired:
Remaining blockers/deferrals:
Contract release required: yes/no
Suggested next bounded task:
```

“Tests pass” without commands/results is not evidence.

## 8. Coordinator review trail

The coordinator checks the diff in this order:

1. Scope: does it solve only the assigned workflow slice?
2. Authority: did browser/agent authority widen?
3. Contracts: generated operation/input still owns structure?
4. Effect: exact/reconcilable identity, no latest-row fallback?
5. Outcome: effect certainty and retry semantics truthful?
6. Business rules: still owned by STDB/domain operation?
7. Error path: expected failures typed through UI boundary?
8. UI: no false completion, dead action or hidden dependency?
9. Tests: actual operator path plus applicable invariant coverage?
10. Integration: any duplicate owner/compat path created?

Only after that does the coordinator run integrated tests and update the ledger.

## 9. Ratchets to add as the prototype is accepted

Prefer automated source/contract checks over relying on prompt discipline:

- no new production use of `/compat/reducer/` outside explicit compatibility allowlist;
- no new `ORDER BY ... DESC LIMIT 1` / latest-row patterns in effect-correlation services;
- no newly migrated cross-module hook returning `void` when a resulting record exists;
- operation coverage must classify every accepted IR operation;
- first-org nav/exposure catalog cannot contain unclassified surfaces;
- primary COV Playwright specs cannot use direct reducer calls for the transition they certify;
- generated operation inputs cannot accept browser-owned organization/permission fields;
- module-specific outcome/error unions that duplicate the shared COV/COH seam should fail review/lint.

Ratchets should start scoped to migrated paths and expand as legacy compatibility is retired. Do not break the whole repository merely to claim a zero baseline.

## 10. Quality rule

A smaller diff that stops on a missing invariant is better than a broad diff that makes the demo pass through heuristics. A worker is rewarded for exposing a missing contract or unsafe ambiguity, not for hiding it.
