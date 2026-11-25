const MAX_FRAME_CHARS = 256 * 1024
const REQUEST_TIMEOUT_MS = 15_000

export class AdapterError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export function deferred() {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

export function jsonLines(process, onMessage, onEnd) {
  let buffer = ''
  let ended = false

  function end(error, exitCode) {
    if (ended) return
    ended = true
    onEnd(error, exitCode)
  }

  function decode(line) {
    if (line.length > MAX_FRAME_CHARS) throw new Error()
    if (line.trim()) onMessage(JSON.parse(line))
  }

  function read(chunk) {
    if (ended) return
    buffer += chunk
    try {
      let nextLine = buffer.indexOf('\n')
      while (nextLine >= 0) {
        decode(buffer.slice(0, nextLine))
        buffer = buffer.slice(nextLine + 1)
        nextLine = buffer.indexOf('\n')
      }
      if (buffer.length > MAX_FRAME_CHARS) throw new Error()
    } catch (error) {
      end(error instanceof AdapterError
        ? error
        : new AdapterError('invalid_frame', 'The local CLI returned an invalid protocol frame.'))
    }
  }

  process.stdout.setEncoding('utf8').on('data', read)
  process.stderr.resume()
  process.once('error', () => end(new AdapterError('process_error', 'Could not run the local CLI.')))
  process.stdout.once('error', () => end(new AdapterError('process_error', 'The local CLI output closed.')))
  process.stdin.on('error', () => end(new AdapterError('process_error', 'The local CLI input closed.')))
  process.once('close', (exitCode) => {
    if (ended) return
    try {
      decode(buffer)
      end(undefined, exitCode)
    } catch (error) {
      end(error instanceof AdapterError
        ? error
        : new AdapterError('invalid_frame', 'The local CLI returned an invalid protocol frame.'))
    }
  })
}

export function rpcPeer(process, { jsonRpcVersion, onNotify, onRequest }) {
  const pending = new Map()
  const exit = deferred()
  let sequence = 0
  let stopped

  function write(message) {
    if (stopped) throw stopped
    const prefix = jsonRpcVersion ? { jsonrpc: jsonRpcVersion } : {}
    process.stdin.write(JSON.stringify({ ...prefix, ...message }) + '\n')
  }

  function finish(error) {
    stopped = error ?? new AdapterError('process_exit', 'The local CLI process exited.')
    for (const request of pending.values()) request.reject(stopped)
    exit.resolve(stopped)
  }

  function receive(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new AdapterError('invalid_frame', 'The local CLI returned an invalid protocol frame.')
    }
    if (typeof message.method === 'string') {
      if (typeof message.id === 'number' || typeof message.id === 'string') {
        onRequest?.(message.method, message.params, message.id)
      } else {
        onNotify?.(message.method, message.params)
      }
      return
    }
    const request = pending.get(message.id)
    if (!request) return
    if (message.error) {
      const code = typeof message.error.code === 'number' ? message.error.code : undefined
      request.reject(new AdapterError(code, 'The local CLI rejected the request.'))
    } else {
      request.resolve(message.result)
    }
  }

  jsonLines(process, receive, finish)

  return {
    async request(method, params, timeout = REQUEST_TIMEOUT_MS) {
      const id = ++sequence
      const response = deferred()
      pending.set(id, response)
      const timer = timeout === null ? undefined : setTimeout(() => {
        response.reject(new AdapterError('request_timeout', 'The local CLI did not respond in time.'))
      }, timeout)
      try {
        write({ id, method, params })
        return await response.promise
      } finally {
        clearTimeout(timer)
        pending.delete(id)
      }
    },
    notify(method, params) {
      write({ method, params })
    },
    reply(id, result) {
      write({ id, result })
    },
    deny(id) {
      write({ id, error: { code: -32601, message: 'Unsupported local runner operation.' } })
    },
    exited: exit.promise
  }
}
