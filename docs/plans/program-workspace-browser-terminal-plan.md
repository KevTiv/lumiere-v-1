# ProgramWorkspace browser terminal and collaborative sandbox plan

**Status:** Proposed — 2026-08-24
**Tracks:** `program-workspace`, `browser-terminal`, `sandbox-debugging`, `code-artifacts`, `work-programs`, `advanced-admin-ui`, `daytona`, `audit`, `collaboration`
**Related:** [work-program-ui-harness-convergence-plan.md](./work-program-ui-harness-convergence-plan.md) · [work-program-runtime-execution-plan.md](./work-program-runtime-execution-plan.md) · [work-program-security-provenance-plan.md](./work-program-security-provenance-plan.md) · [agent-sandbox-data-analysis-plan.md](./agent-sandbox-data-analysis-plan.md) · [frontend-multisurface-workflow-presentation-plan.md](./frontend-multisurface-workflow-presentation-plan.md)

---

## 1. Objective

Add an advanced `ProgramWorkspace` surface for technical admins/developers to inspect, run, debug, and refine the same isolated sandbox environment used by the harness.

The workspace is not a shell into the user's device, the ERP host, SpacetimeDB, Postgres, or deployment infrastructure. It is a browser/desktop UI attached only to an authorized task/program sandbox.

Target model:

```text
Browser / desktop UI
      ↓
ProgramWorkspace
  ├── Files
  ├── Program editor/diff
  ├── Terminal
  ├── Dataset schemas
  ├── Evidence
  ├── Artifacts
  ├── Logs
  └── Run history
      ↓
ProgramRun / SandboxSession
      ↓
SandboxProvider / Daytona
      ↓
constrained Lumière runtime
```

The purpose is to make AI-created reusable work inspectable and maintainable by advanced users without creating a second execution authority or allowing useful manual edits to disappear outside the artifact/versioning system.

---

## 2. Non-negotiable boundary

Allowed attachment target:

```text
ProgramRun
SandboxSession
ImportRun sandbox
DocumentAnalysisRun sandbox
```

Never expose:

```text
client-device local shell
production host shell
STDB administrative shell
Postgres shell
Kubernetes/container host
Scaleway account credentials
arbitrary SSH targets
```

The workspace inherits the exact runtime profile and policy of the attached sandbox:

```text
network policy
filesystem policy
CPU / RAM / disk budget
runtime timeout / TTL
dataset grants
external capability grants
package allowlist
```

Opening a terminal must not widen authority.

---

## 3. Product positioning

Treat `ProgramWorkspace` as an advanced implementation/debugging surface, not a normal ERP navigation primitive.

Suggested user levels:

```text
normal user
→ run published WorkProgram

admin
→ configure inputs / placement / schedule / publish

technical admin/developer
→ open ProgramWorkspace
```

The main user-facing abstraction is **Workspace**, not `/bin/bash`.

Canonical semantic surfaces:

```text
ProgramWorkspace
├── Files
├── Program
├── Terminal
├── Dataset schemas
├── Evidence
├── Artifacts
├── Logs
├── Run history
└── Diff
```

The terminal is one panel in that workspace.

---

## 4. Session model

```ts
interface ProgramWorkspaceSession {
  id: ProgramWorkspaceSessionId
  organizationId: OrganizationId
  actorId: ActorId

  source:
    | { kind: "program-run"; run: ProgramRunId }
    | { kind: "sandbox-session"; sandbox: SandboxSessionRef }
    | { kind: "reproduction"; sourceRun: ProgramRunId }

  sandbox: SandboxHandleRef
  runtimeProfile: RuntimeProfileRef

  permissions: ProgramWorkspacePermissions
  status: "starting" | "active" | "closing" | "closed" | "expired"

  createdAt: string
  expiresAt: string
  correlationId: CorrelationId
}
```

Trusted organization/actor identity comes from server context, never terminal input.

### Workspace permissions

```ts
interface ProgramWorkspacePermissions {
  canReadFiles: boolean
  canEditDraftFiles: boolean
  canRunProgram: boolean
  canOpenTerminal: boolean
  canCreateArtifactDraft: boolean
  canPersistCodeArtifactDraft: boolean
}
```

These are UI/workspace permissions, not ERP capability grants.

---

## 5. Browser terminal transport

Use a browser terminal emulator such as xterm.js only as the rendering layer.

The shell/PTY executes inside the sandbox.

```text
xterm.js / renderer
     ↓ authenticated WebSocket
WorkspaceTerminalGateway
     ↓ session/capability validation
SandboxProvider terminal/PTY adapter
     ↓
sandbox PTY
```

Requirements:

- authenticated, organization-scoped WebSocket upgrade;
- short-lived terminal/session token bound to WorkspaceSessionId + actor + organization;
- origin validation;
- TLS only outside trusted local development;
- terminal reconnect may reattach only while the same workspace session remains valid;
- terminal connection loss must not grant longer sandbox lifetime;
- terminal input/output correlation must be auditable without treating shell history as hidden model reasoning;
- renderer must treat terminal output as untrusted text/content.

Do not expose provider terminal URLs/tokens directly to the browser where a Lumière gateway can mediate the session.

---

## 6. Runtime contents

Approved runtimes may include normal analytical/debugging tools:

```text
python
Lumière Python SDK
polars / pyarrow
openpyxl where profile permits
jq
rg
cat / less
basic shell tools
git-style diff tooling
Lumière CLI
```

Do not expose by default:

```text
psql against authoritative databases
spacetime admin/SQL credentials
ssh
cloud provider CLIs with credentials
Docker/privileged container control
unrestricted curl/wget network access
host filesystem mounts
package installation from arbitrary public sources
```

Actual availability remains runtime-profile specific.

---

## 7. Lumière CLI

Add a first-class CLI that uses the same broker/control-plane APIs as model tools and frontend actions.

Initial conceptual commands:

```bash
lumiere datasets list
lumiere datasets describe ds_123
lumiere evidence list
lumiere artifacts list
lumiere program validate report.py
lumiere program run report.py
lumiere program diff
lumiere artifact draft report.py
```

Capability discovery may later include:

```bash
lumiere capabilities search inventory
lumiere capabilities describe inventory.forecast.dataset
```

Rules:

- CLI never receives broad ERP credentials;
- every brokered read/action is authorized exactly as corresponding generated capability calls are;
- CLI commands must carry task/workspace/correlation identity;
- sandbox code still cannot directly mutate ERP state;
- consequential operations remain draft/approval/capability paths.

Target convergence:

```text
AI tool call
UI action
Lumière CLI
WorkProgram step
      ↓
same typed capability/runtime layer
```

---

## 8. File and edit persistence

The sandbox filesystem remains scratch.

Manual edits must not silently become durable business configuration.

```text
workspace file edit
      ↓
WorkspaceFileDiff
      ↓
explicit Save as draft
      ↓
CodeArtifactDraft / TemplateArtifactDraft
      ↓
certification / review
      ↓
published immutable version
```

Conceptual diff record:

```ts
interface WorkspaceFileDiff {
  workspaceSession: ProgramWorkspaceSessionId
  baseArtifact?: ArtifactRef
  path: string
  beforeHash?: string
  afterHash: string
  changedBy: ActorId
  correlationId: CorrelationId
}
```

Do not make sandbox snapshots the durable edit history.

---

## 9. Reproduction after sandbox destruction

If a ProgramRun's original sandbox no longer exists, support **Reproduce workspace**, not permanent VM recovery.

```text
historical ProgramRun
      ↓
runtime profile/version
CodeArtifact refs
input contract
artifact/evidence/provenance refs
      ↓
current authorization
      ↓
new sandbox
      ↓
reproduction workspace
```

Rules:

- fresh authorization is mandatory;
- stale DatasetHandles are not silently revived;
- if original raw data is no longer available under current retention/policy, reproduction is partial and reported honestly;
- historical artifacts/evidence may be mounted read-only where authorized;
- reproduction gets a new sandbox/session/correlation identity linked to the source run.

---

## 10. Human + agent collaborative editing

Allow the user and agent to operate on the same **artifact draft**, not through invisible competing filesystem mutations.

Example:

```text
User: "group this report by farm"
      ↓
agent proposes patch to report.py
      ↓
Workspace diff
  - group_by("month")
  + group_by(["farm_id", "month"])
      ↓
[Run] [Accept] [Revert]
```

The agent may author/edit files only through the task/workspace execution APIs and subject to the same runtime constraints.

Persist meaningful accepted edits as artifact drafts.

---

## 11. ProgramRun integration

Recommended UI:

```text
Program Run #814

[Overview] [Steps] [Evidence] [Artifacts] [Logs] [Workspace]
```

Workspace state should expose:

```text
sandbox starting
sandbox active
sandbox paused (if supported/approved)
sandbox expired
reproduction available
```

A workspace must not outlive its allowed sandbox/session TTL merely because a browser tab is open.

---

## 12. Security and audit

Integrate with `work-program-security-provenance-plan.md`.

Minimum events:

```text
WorkspaceOpened
WorkspaceClosed
TerminalOpened
TerminalClosed
WorkspaceFileChanged
ArtifactDraftCreated
WorkspaceProgramExecuted
WorkspaceReproductionCreated
```

Record:

```text
actor
organization
WorkspaceSessionId
ProgramRunId when applicable
SandboxSessionRef
runtime profile/version
correlation ID
file/artifact hashes
```

Do not store secrets or transform terminal audit into full keystroke surveillance by default. Prefer semantic events, file diffs, command execution metadata where available, and sandbox process logs required for security/debugging.

### Untrusted terminal output

Terminal output can contain control sequences and arbitrary content. Browser renderer/gateway must enforce safe terminal handling and must never treat output as trusted HTML or application instructions.

---

## 13. Performance/admission

Opening a workspace is an expensive sandbox operation and participates in AI/sandbox admission.

Track separately:

```text
active workspace sandboxes
active terminal sessions
workspace CPU / memory seconds
idle workspace time
reproduction starts
```

Policies:

- bound active workspaces per actor/org;
- idle timeout;
- absolute TTL;
- explicit user keepalive only within policy;
- prefer existing active ProgramRun sandbox when safe rather than creating duplicate workspace sandbox;
- technical/admin workspaces must not starve interactive ERP or normal AI workloads.

---

## 14. UI integration

Extend shared presentation primitives with:

```text
ProgramWorkspaceLauncher
ProgramWorkspaceShell
WorkspaceFileBrowser
WorkspaceEditor
WorkspaceTerminal
WorkspaceDatasetInspector
WorkspaceEvidencePanel
WorkspaceArtifactPanel
WorkspaceRunLog
WorkspaceDiffReview
```

The shared frontend contract describes workspace intent/status. Terminal implementation remains renderer-specific.

Web is the first full workspace target.

Expo/mobile should initially support:

```text
run logs
files/artifacts/evidence viewing
diff/approval where appropriate
```

but does not need to provide a full terminal/editor experience in the first implementation.

---

## 15. Local client execution is explicitly separate

Do not interpret browser terminal support as permission to execute on the user's own computer.

A future local executor would be a separate architecture:

```text
Lumière
   ↓
explicit local action request
   ↓
local companion service
   ↓
user permission/confirmation
   ↓
restricted local capability
```

It must not reuse sandbox authority assumptions and is out of scope for this plan.

---

## 16. Implementation phases

### WORKSPACE0 — contracts and security proof

- [ ] define `ProgramWorkspaceSession` and permission model;
- [ ] define attachment/reproduction semantics;
- [ ] define workspace/terminal audit events;
- [ ] prove terminal does not widen runtime profile/network/data authority;
- [ ] decide provider-neutral terminal/PTy seam beneath `SandboxProvider`.

### WORKSPACE1 — web terminal proof

- [ ] add web `ProgramWorkspaceShell`;
- [ ] integrate browser terminal renderer;
- [ ] add authenticated WorkspaceTerminalGateway;
- [ ] attach to one approved sandbox runtime;
- [ ] prove no host/STDB/PG/cloud credentials are present;
- [ ] implement terminal TTL/disconnect cleanup.

### WORKSPACE2 — files, diff and artifact drafts

- [ ] add file browser/editor for approved workspace paths;
- [ ] generate file diffs/hashes;
- [ ] add `Save as CodeArtifactDraft`;
- [ ] integrate certification/version lifecycle;
- [ ] ensure closing/destroying sandbox loses unsaved scratch changes by design.

### WORKSPACE3 — Lumière CLI

- [ ] implement dataset/evidence/artifact/program commands;
- [ ] route CLI through same broker/capability layer;
- [ ] add correlation/audit identity;
- [ ] prohibit direct ERP/database credentials;
- [ ] add capability discovery only after generated registry contracts are stable.

### WORKSPACE4 — ProgramRun debugging/reproduction

- [ ] expose Workspace tab from ProgramRun;
- [ ] attach to active run sandbox where policy permits;
- [ ] implement Reproduce workspace from durable manifests/artifacts;
- [ ] handle unavailable historical datasets explicitly;
- [ ] add run/evidence/artifact/log panels.

### WORKSPACE5 — collaborative authoring

- [ ] allow agent-proposed artifact patches to surface as workspace diffs;
- [ ] user can run/accept/revert;
- [ ] accepted changes create artifact drafts;
- [ ] prove AI and manual edits share the same certification/publication pipeline.

---

## 17. Required tests

1. terminal can attach only to an authorized active WorkspaceSession;
2. organization A cannot attach to organization B sandbox/session;
3. terminal access does not expose STDB/PG/cloud credentials;
4. runtime network restrictions remain effective through terminal commands;
5. idle/TTL expiry terminates workspace access;
6. disconnect/reconnect cannot extend or hijack sandbox lifetime;
7. arbitrary terminal output does not become trusted HTML/application content;
8. manual file edits persist only through explicit artifact-draft creation;
9. destroyed sandbox scratch edits disappear unless persisted;
10. reproduction requires fresh authorization and new session identity;
11. stale DatasetHandles cannot be reused through reproduction;
12. CLI capability/data access uses the same trusted broker path as normal harness execution;
13. workspace activity is correlated with ProgramRun/task/audit events;
14. opening workspaces respects organization/user sandbox admission limits;
15. no browser terminal path can target arbitrary hostnames or local client shell.

---

## 18. Acceptance criteria

This plan is successful when:

- a technical admin can inspect and debug a ProgramRun inside the same constrained sandbox environment used by the harness;
- browser terminal access adds no new ERP/database/cloud authority;
- the workspace exposes files, terminal, evidence, artifacts, logs and diffs as one coherent debugging surface;
- useful manual edits can become versioned `CodeArtifactDraft`s and enter the normal certification pipeline;
- an expired/destroyed sandbox can be reproduced from durable program/runtime/artifact manifests where current policy/data availability permits;
- the Lumière CLI and AI tools converge on the same typed broker/capability interfaces;
- WorkProgram/ProgramRun remains the canonical lifecycle rather than the terminal becoming a side-channel;
- local-device terminal execution remains explicitly separate and out of scope.
