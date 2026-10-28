# Railway JavaScript sandbox implementation status

Status: implementation candidate, 2026-10-28. Production admission is disabled.

This slice implements the backend foundations for JavaScript analysis in
Railway sandboxes. It does not certify a deployed sandbox, enable tenant
execution, grant a new ERP permission, provision Railway resources, or make a
paid provider call. Release of the code and independent certification of the
released runtime are separate gates.

Governing plans:

- [Sandbox data-analysis plan](../plans/agent-sandbox-data-analysis-plan.md)
- [Harness security and sandbox certification](../plans/harness-security-residency-sandbox-certification.md)
- [Implementation ledger: SBX and SEC](./erp-harness-implementation-ledger.md)

## Architecture

```text
Current actor/session + generated capability grants
  -> governed Rust gateway
  -> trusted sandbox controller
       -> opaque scoped dataset handle + private materialization
       -> Railway management API / file transfer
            -> isolated VM, pinned runtime profile
                 -> disposable QuickJS WASM worker
                    datasets.open / evidence.emit / artifacts.emit
       <- bounded outputs, independently validated by broker
       -> persisted hashes and output references
  -> existing evidence and answer admission
```

The Rust gateway remains responsible for trusted actor, organization, company,
run and current-policy context. A program cannot supply its own authority or
select a database, SQL query, URL, storage path or Railway environment. The
controller receives authorized materializations; it does not become another ERP
query or mutation interface.

The controller holds Railway management credentials. Those credentials and ERP,
object-store and model-provider credentials must never enter the VM. Inputs and
outputs move through fixed file paths using the provider's file API. Program
text is file content and is never interpolated into a shell command.

## Code boundary

| Component | Candidate implementation | Admission limit |
| --- | --- | --- |
| Gateway adapter | Typed internal requests and bounded responses under server-derived run scope; generated reads keep rows on the trusted side | No advertised production analysis tool or new broad execution route |
| Current authority | Actor-bound gateway headers and a fixed API capability-grant recheck at every broker boundary | Actor credentials stay in controller closures and sensitive transport headers; never in journal records or VM inputs |
| Dataset broker | Opaque IDs; schema/row/byte ceilings; scope, policy-generation, expiry, revocation and reauthorization checks | Safe handle metadata is model-visible; materialized rows are not |
| JavaScript runtime | Actual guest JavaScript in QuickJS WASM inside a disposable worker; bounded memory, stack, time and emissions | No Node globals, module loading, filesystem, network or process callbacks; not `node:vm` |
| Evidence and artifacts | Named disclosure policies, admitted source handles, strict shape/cardinality/byte limits and content hashes | Raw stdout/stderr and arbitrary strings/files cannot become evidence automatically |
| Railway provider | Provider-neutral lifecycle around the pinned Railway SDK, explicit region/resources, fixed execution entry point and session reconciliation | Default public egress is not accepted as an enforced egress policy |
| Operational persistence | Private SQLite journal for execution identity/recovery and controller-managed outputs | One controller replica with a durable volume; not canonical ERP state or a permanent dataset archive |

Source: [controller package](../../sandbox-controller/) and
[gateway sandbox adapter](../../ai-gateway/src/sandbox/).

The initial disclosure policies restrict output structure. They do not prove
that arbitrary model-authored arithmetic is correct, or provide a formal
privacy guarantee against encoding individual values as numbers. Existing
answer/claim verification still applies. Policy and runtime certification must
cover the actual workload before production admission.

The journal is an operational recovery mechanism. Tenant data in it still
requires protected storage, bounded retention and deletion. A handle becoming
unusable at expiry is not, on its own, proof that its stored bytes were deleted.
Canonical program/artifact promotion, cross-service audit projection and broader
retention/legal-hold requirements remain governed by the parent plans.

Execution identity binds the actual provider profile digest. Terminal state and
the original compute reservation settle atomically. Cancellation, delayed
authorization and concurrent reconciliation cannot overwrite completed outcomes
or release a cancelled run's evidence. Cleanup remains pending until provider
destruction is confirmed; ambiguous creation with no known VM ID retains its
reservation for reconciliation rather than dispatching a second VM.

## Railway assumptions that require deployment proof

Railway sandboxes are VMs scoped to an environment. Their default `ISOLATED`
network mode excludes that environment's private network, while retaining
outbound internet access. Do not use `PRIVATE` to make ERP databases reachable.
No public domain is needed for this runtime.

An explicit approved region is required; fresh sandbox creation must not rely on
the provider's default region. Read back actual placement. Templates are built
from pinned runtime files before tenant input is supplied. Never checkpoint or
fork a tenant-populated filesystem into a reusable base.

The guest Node 24.19.0 linux-x64 archive is pinned by its official SHA-256 and
verified before extraction. Runner and dependency installation use that exact
interpreter with a cleared environment. Railway's underlying base OS remains
provider-managed; its identity and drift controls still require deployment
attestation. The profile currently pins source, interpreter, npm dependencies
and resource policy, not an immutable Railway base-image digest.

The QuickJS capability boundary removes ambient host I/O from guest JavaScript.
It does not certify the VM's network policy, host escape resistance, dependency
supply chain, or the trustworthiness of arbitrary controller code. An enforced
egress/runtime boundary outside the guest program's control remains a production
gate. If it cannot be established, keep customer data out and use synthetic
fixtures only.

Provider availability, account entitlement, approved-region capacity and current
SDK behavior must be checked against the actual Railway workspace. The code
does not establish those facts. Provider documentation:
[sandboxes](https://docs.railway.com/sandboxes),
[networking](https://docs.railway.com/sandboxes#networking), and
[configuration](https://docs.railway.com/sandboxes#configuration).

## Validation before release

Run the standalone package with Node 24:

```sh
cd sandbox-controller
npm ci --ignore-scripts
npm test
npm run acceptance:synthetic
```

CI requires that command in the JavaScript sandbox controller job. The test suite
executes real guest JavaScript locally and exercises broker, lifecycle and
recovery behavior. Railway driver doubles establish adapter behavior only;
they are not live provider isolation or execution acceptance. No Railway token
or customer dataset belongs in this lane.

Run the gateway's required compilation/tests and the repository's normal CI
gates for the final PR head. Do not infer a passing released/runtime-image gate
from an isolated Rust or local package test. Record final test results and exact
source/runtime hashes in the PR; this document deliberately does not copy
historical pass counts onto a new head.

The deployment composition and HTTP dispatcher are implemented behind the hard
build fence. After reviewed admission, deployment-owned configuration supplies
the fixed API origin, source-capability set, Railway environment/region,
separate service credentials and private persistent journal path. Per-request
actor headers build fresh authority callbacks. A bounded maintenance loop
purges expired dataset rows and reconciles expired known VM handles. No
environment variable can bypass the initial build fence or manufacture a
certification. Unknown creations without an ID require provider/operator
reconciliation; listing an environment is not permission to delete unrelated VMs.

## Certification after release

Production admission requires a separate review tied to the exact released
program, controller/runtime dependency hashes, profile, provider, region and
policy. An environment variable or caller-supplied `certified` value cannot
enable the initial build.

The certification run must establish:

1. Direct STDB/Postgres access, public database endpoints, unrestricted egress,
   metadata endpoints, host files/sockets and credential discovery are denied.
2. Another actor/company/tenant/run cannot materialize or export a handle;
   revocation, expiry and policy-generation changes block the next protected
   operation, including after reconnect or restart.
3. Actual memory, CPU, output, duration, concurrency and compute-cost limits
   hold. Provider defaults, idle timeout and model-token budgets are not
   substitutes for these limits.
4. Interrupted or ambiguous dispatch is reconciled by durable execution/session
   identity; no blind retry creates a second computation or consequential ERP
   effect. Failed cleanup remains discoverable for reconciliation.
5. Success, failure, cancellation, disconnect and controller restart clean up
   tenant materializations and terminate or reconcile orphan sandboxes.
6. Actual region, log/output retention and temporary-copy deletion match policy.
   Tenant A's execution cannot leave data in Tenant B's subsequent sandbox,
   template or restored state.
7. One read-only finance workload completes through current authorization,
   brokered data, JavaScript analysis, evidence admission and durable readback.
   Output can be reopened after the VM is destroyed.

Enablement must follow that reviewed evidence and preserve the existing skill,
capability, approval and answer gates. ERP mutations continue through the normal
typed draft/approval/reducer path; the sandbox receives no mutation authority.

## Ledger reconciliation

This candidate contributes code toward `SBX-00` (provider boundary), `SBX-01`
(JavaScript profile), `SBX-02` (dataset broker), `SBX-03` (SDK/evidence boundary)
and `SEC-02` (isolation tests). These packages are not `ACCEPTED` merely because
local tests or PR CI pass. Deployed proof, independent certification and the
remaining persistence/retention integrations still apply.

Full Python analysis profiles, Daytona, terminal workspaces, warm pools,
general document/spreadsheet generation, recipe promotion and automatic
production resume are later work. The T3 follow-up queue UI, provider handoff
completion and budget parking dispatcher are not prerequisites for this bounded
read-only sandbox slice; they cannot bypass its admission requirements.
