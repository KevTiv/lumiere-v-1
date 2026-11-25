# Lumière local runner

The native runner launches a user's installed Codex, Claude Code, Antigravity, or Vibe CLI from a private working directory. Provider credentials stay with the CLI. The runner keeps a device credential and unacknowledged attempt events in its private local state directory.

## Development

Use Node 24 or later. Run the protocol, host, adapter, and reconnect fixtures from the repository root.

```sh
node --test 'local-runner/**/*.test.mjs' scripts/tests/local-runner-replay.test.mjs
node local-runner/bin/lumiere-runner.mjs --help
```

The runner can pair once a compatible gateway provides a one-time code and enables device connections.

```sh
node local-runner/bin/lumiere-runner.mjs pair --gateway https://your-runner-gateway
node local-runner/bin/lumiere-runner.mjs run
```

Production discovery is disabled in this implementation. Release requires durable gateway storage, authenticated native transport, and scoped ERP execution and verified readback. See the [acceptance matrix](../docs/evidence/local-runner-pilot.md).

## Protocol

Version 1 is defined in [v1.mjs](./protocol/v1.mjs). The native socket sends the device ID and device bearer in separate headers. Pairing exchanges the code for that credential once. The server binds dispatch to its stored device, actor and company. A dispatch carries the run ID, attempt ID and lease ID. Those IDs fence subsequent events, permission replies and cancellation. The server acknowledges a sequence only after persisting the corresponding event.

The provider's final text is sent as a candidate for server verification. The browser consumes a separate event projection and receives an answer only after server admission.
