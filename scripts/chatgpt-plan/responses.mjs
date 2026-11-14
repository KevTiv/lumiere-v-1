import { SmokeError } from './errors.mjs'

const API_BASE = 'https://api.openai.com/v1'
const NAMESPACE = 'inventory'
const TOOL_NAME = 'has_products'
const REASONING_REPLAY = ['reasoning.encrypted_content']
const PRODUCT_TOOL = {
  type: 'namespace',
  name: NAMESPACE,
  description: 'Read-only access to the local Lumière product catalog',
  tools: [
    {
      type: 'function',
      name: TOOL_NAME,
      description: 'Check whether the current Lumière organization has a visible product',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      strict: true,
    },
  ],
}

export function safeFetch(fetcher, url, options = {}) {
  return fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(60_000) })
}

export async function readJson(response) {
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > 2 * 1024 * 1024) throw new SmokeError('Unexpectedly large JSON response')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new SmokeError('Invalid JSON response')
  }
}

export async function parseResponsesStream(body) {
  const decoder = new TextDecoder()
  let remaining = ''
  let size = 0
  for await (const chunk of body) {
    size += chunk.byteLength
    if (size > 4 * 1024 * 1024) throw new SmokeError('ChatGPT response exceeded the local smoke test limit')
    remaining += decoder.decode(chunk, { stream: true })
    const events = remaining.split(/\r?\n\r?\n/)
    remaining = events.pop()
    for (const event of events) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n')
      if (!data || data === '[DONE]') continue
      let payload
      try {
        payload = JSON.parse(data)
      } catch {
        throw new SmokeError('Invalid ChatGPT stream event')
      }
      if (['response.failed', 'response.incomplete', 'error'].includes(payload.type)) {
        const code = payload.response?.error?.code ?? payload.code
        if (code === 'subscription_sharing_usage_limit_exceeded') {
          throw new SmokeError('This ChatGPT plan reached its usage limit')
        }
        if (code === 'subscription_sharing_usage_unavailable') {
          throw new SmokeError('ChatGPT plan usage is currently unavailable')
        }
        throw new SmokeError('ChatGPT did not complete the response')
      }
      if (payload.type === 'response.completed') {
        if (!Array.isArray(payload.response?.output)) throw new SmokeError('Invalid ChatGPT response')
        return payload.response.output
      }
    }
  }
  throw new SmokeError('ChatGPT stream ended before completion')
}

export async function availableModel(accessToken, requestedModel, fetcher) {
  const response = await safeFetch(fetcher, API_BASE + '/models', {
    headers: { Authorization: 'Bearer ' + accessToken },
  })
  if (!response.ok) throw new SmokeError('ChatGPT plan model discovery failed (' + response.status + ')')
  const result = await readJson(response)
  if (!Array.isArray(result.models)) throw new SmokeError('ChatGPT returned an invalid model catalog')
  const models = result.models
    .filter((model) => model.visibility === 'list' && typeof model.slug === 'string')
    .map((model) => model.slug)
  const selected = requestedModel ?? models[0]
  if (!models.includes(selected)) throw new SmokeError('The selected ChatGPT plan has no matching model')
  return selected
}

async function respond(accessToken, request, fetcher) {
  const response = await safeFetch(fetcher, API_BASE + '/responses', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...request, store: false, stream: true }),
  })
  if (!response.ok) throw new SmokeError('ChatGPT inference failed (' + response.status + ')')
  if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
    throw new SmokeError('Expected a streaming ChatGPT response')
  }
  return parseResponsesStream(response.body)
}

async function productExists({ port, organizationId, token }, fetcher = fetch) {
  const url = new URL('http://127.0.0.1:' + port + '/v1/query/products')
  url.search = new URLSearchParams({ organizationId, limit: '1' })
  const response = await safeFetch(fetcher, url, {
    headers: { Authorization: 'Bearer ' + token },
  })
  if (!response.ok) throw new SmokeError('Local Lumière product query failed (' + response.status + ')')
  const result = await readJson(response)
  if (!Array.isArray(result.data)) throw new SmokeError('Local Lumière returned an invalid product list')
  return { hasVisibleProducts: result.data.length > 0 }
}

export async function runSmoke({ accessToken, model, erp }, fetcher = fetch) {
  if (!erp) {
    const input = [{ role: 'user', content: 'Reply with exactly "Lumière ChatGPT plan connected".' }]
    return answerText(await respond(accessToken, { model, input }, fetcher))
  }

  const input = [
    {
      role: 'user',
      content: 'Use the inventory tool and tell me whether there are visible products in the local catalog.',
    },
  ]
  const tools = [PRODUCT_TOOL]
  const output = await respond(
    accessToken,
    { model, input, tools, tool_choice: 'required', include: REASONING_REPLAY },
    fetcher,
  )
  const calls = output.filter((item) => item.type === 'function_call')
  const call = calls[0]
  if (
    calls.length !== 1 ||
    call.namespace !== NAMESPACE ||
    call.name !== TOOL_NAME ||
    typeof call.call_id !== 'string' ||
    !/^[-_a-zA-Z0-9]{1,128}$/.test(call.call_id) ||
    typeof call.arguments !== 'string' ||
    !/^\s*\{\s*\}\s*$/.test(call.arguments)
  ) {
    throw new SmokeError('ChatGPT did not request the expected read-only product check')
  }
  if (
    output.some(
      (item) =>
        item.type !== 'function_call' &&
        (item.type !== 'reasoning' || typeof item.encrypted_content !== 'string' || !item.encrypted_content),
    )
  ) {
    throw new SmokeError('This model did not return a replayable tool turn. Try another plan model')
  }
  const result = await productExists(erp, fetcher)
  const continuation = [
    ...input,
    ...output,
    { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) },
  ]
  return answerText(
    await respond(accessToken, { model, input: continuation, tools, tool_choice: 'none' }, fetcher),
  )
}

function answerText(output) {
  const text = output
    .filter((item) => item.type === 'message' && item.role === 'assistant')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .trim()
  if (!text) throw new SmokeError('ChatGPT returned no answer text')
  return text
}
