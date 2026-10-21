#!/usr/bin/env node

import { bootstrapProductionIdentities } from './lib/production-identity-bootstrap.mjs'

function usage() {
  console.log(`Usage: node scripts/bootstrap-production-identities.mjs [--apply] [--mode bootstrap|rotate]

Without --apply the command validates configuration and prints a redacted plan.
Required environment variables:
  STDB_HOST, STDB_MODULE, STDB_SERVER_TOKEN
  DOPPLER_API_TOKEN, DOPPLER_PROJECT, DOPPLER_CONFIG_MAP_JSON
  AI_CERTIFICATION_RUNTIME_HASH, LUMIERE_IDENTITY_RUN_ID

Set LUMIERE_INITIALIZE_NON_ROTATING_SECRETS=1 only on the first bootstrap to
create encryption and shared internal keys. Rotation additionally requires
LUMIERE_ROTATION_DRAINED=1.`)
}

let apply = false
let mode = 'bootstrap'
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index]
  if (argument === '--apply') apply = true
  else if (argument === '--mode') mode = process.argv[++index]
  else if (argument === '--help' || argument === '-h') {
    usage()
    process.exit(0)
  } else {
    console.error(`Unknown argument: ${argument}`)
    usage()
    process.exit(2)
  }
}

try {
  const result = await bootstrapProductionIdentities({ env: process.env, apply, mode })
  if (!apply) console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`[identity-bootstrap] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
