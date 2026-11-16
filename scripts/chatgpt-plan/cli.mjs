import { parseArgs } from 'node:util'
import { signIn } from './oauth.mjs'
import { availableModel, runSmoke } from './responses.mjs'
import { SmokeError } from './errors.mjs'

const HELP = `Usage: node scripts/chatgpt-plan/cli.mjs [options]
  --profile LABEL        Local registration label (default: default)
  --model SLUG           Select a model from your ChatGPT plan's catalog
  --erp-organization ID  Test an actor-authorized product read from localhost
  --erp-port PORT        Local API server port (default: 8082)
  --help                 Show this help

Continue with ChatGPT in your browser to authorize a local inference smoke test.
This test uses your eligible ChatGPT plan. The local ERP test reads its Lumière
user-session token from stdin, and sends only product presence to OpenAI.
Manage ChatGPT plan connections at https://chatgpt.com/#settings/Usage
`

async function readActorToken() {
  if (process.stdin.isTTY) throw new SmokeError('Pipe a local Lumière user-session token into stdin')
  const chunks = []
  let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.byteLength
    if (size > 8192) throw new SmokeError('Lumière token exceeded the input limit')
    chunks.push(chunk)
  }
  const token = Buffer.concat(chunks).toString('utf8').trim()
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new SmokeError('Expected a Lumière user-session JWT')
  return token
}

async function main() {
  let values
  try {
    values = parseArgs({
      options: {
        profile: { type: 'string', default: 'default' },
        model: { type: 'string' },
        'erp-organization': { type: 'string' },
        'erp-port': { type: 'string', default: '8082' },
        help: { type: 'boolean' },
      },
    }).values
  } catch {
    throw new SmokeError('Invalid arguments. Use --help for the supported options')
  }
  if (values.help) {
    process.stdout.write(HELP)
    return
  }
  if (!['darwin', 'linux'].includes(process.platform)) {
    throw new SmokeError('This local browser sign-in prototype supports macOS and Linux')
  }
  let erp
  if (values['erp-organization'] !== undefined) {
    const organizationId = values['erp-organization']
    const port = Number(values['erp-port'])
    if (!/^[1-9]\d{0,19}$/.test(organizationId) || BigInt(organizationId) > 2n ** 64n - 1n) {
      throw new SmokeError('Expected a positive Lumière organization ID')
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new SmokeError('Expected a valid localhost API port')
    }
    erp = { organizationId, port, token: await readActorToken() }
  }

  process.stderr.write('Continue with ChatGPT in your browser. This test uses your ChatGPT plan.\n')
  if (erp) process.stderr.write('The tool will send only product presence to OpenAI.\n')
  const accessToken = await signIn(values.profile)
  const model = await availableModel(accessToken, values.model, fetch)
  const result = await runSmoke({ accessToken, model, erp })
  process.stdout.write(result + '\n')
}

main().catch((error) => {
  // HTTP libraries can attach provider URLs and response bodies. Keep failures free of tokens.
  const message = error instanceof SmokeError ? error.message : 'Local ChatGPT plan smoke test failed'
  process.stderr.write(message + '\n')
  process.exitCode = 1
})
