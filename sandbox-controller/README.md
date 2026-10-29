# JavaScript sandbox foundation

This package implements the Railway provider adapter, scoped dataset broker,
bounded QuickJS runtime, durable operational journal and execution coordinator.
Production execution is disabled in code pending post-release certification.
The HTTP surface authenticates and refuses executable traffic; no environment
variable enables it. See the [implementation status and release gates](../docs/plan/railway-js-sandbox-status.md).

Requires Node 24. Install and run the actual JavaScript and recovery tests:

```sh
npm ci --ignore-scripts
npm test
npm run acceptance:synthetic
```

The synthetic command uses generated fixture data, real QuickJS and a real
temporary SQLite journal. It does not create Railway resources or certify VM
isolation. Runtime template dependencies have a separate lockfile under
`runtime/`; only trusted runner files and QuickJS are shipped into the VM.

The controller is a single-replica service. Operational SQLite storage must use
a private persistent volume before live lifecycle admission; it is not ERP
business authority. Private dataset rows are removed on revocation, expiry or
confirmed execution cleanup. Validated outputs remain scoped and durable.
Production retention, at-rest storage and deletion proof remain certification
gates. Compute admission uses conservative reserved CPU-time units, not an
assertion about Railway invoices.

Railway's `ISOLATED` network mode still permits public internet access. The
guest engine exposes no network, filesystem or subprocess APIs, but this does
not establish an independently certified egress or VM escape boundary. Do not
load customer data or enable the HTTP execution path before those gates pass.
