import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer, WebSocket } from 'ws'

const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })
const handle = app.getRequestHandler()

// SpacetimeDB configuration from private env vars (never exposed to browser)
const STDB_HOST = (process.env.STDB_HOST || 'wss://maincloud.spacetimedb.com').replace(/\/$/, '')
const STDB_MODULE = process.env.STDB_MODULE || process.env.NEXT_PUBLIC_STDB_MODULE || 'lumiere-v1-j1uo0'
const WS_PREFIX = '/api/stdb'

await app.prepare()

const nextUpgrade = app.getUpgradeHandler()

const httpServer = createServer((req, res) => {
  handle(req, res, parse(req.url, true))
})

const wss = new WebSocketServer({ noServer: true })

httpServer.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url || '/', 'http://localhost')
  const pathname = u.pathname

  // Match `/api/stdb` and `/api/stdb/v1/...` (SDK builds subscribe URL under the proxy base).
  if (!pathname.startsWith(WS_PREFIX)) {
    void nextUpgrade(req, socket, head).catch((err) => {
      console.error('[Next] WebSocket upgrade failed:', err)
      socket.destroy()
    })
    return
  }

  const cookieHeader = req.headers.cookie || ''
  const cookies = Object.fromEntries(
    cookieHeader.split(';').filter(Boolean).map((c) => {
      const [key, ...value] = c.trim().split('=')
      return [key, value.join('=')]
    }),
  )
  let userToken = cookies['stdb_token']
  if (!userToken) {
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer ')) {
      userToken = auth.slice(7)
    }
  }
  if (!userToken) {
    userToken = u.searchParams.get('token')
  }
  if (!userToken) {
    userToken = process.env.STDB_SERVER_TOKEN
  }

  if (!userToken) {
    console.warn('[WS Proxy] Rejected connection: no stdb_token cookie, query token, or server token')
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  let rel = pathname.slice(WS_PREFIX.length)
  if (!rel.startsWith('/')) rel = `/${rel}`
  if (rel === '/' || rel === '') {
    rel = `/v1/database/${STDB_MODULE}/subscribe`
  }

  const upstreamUrl = `${STDB_HOST}${rel}${u.search}`
  const subprotocol = req.headers['sec-websocket-protocol']
  const hasQueryToken = u.searchParams.has('token')

  console.log(`[WS Proxy] Upgrade → ${upstreamUrl}`)

  wss.handleUpgrade(req, socket, head, (clientWs) => {
    // Short-lived subscribe tokens are passed in the query string; long-lived tokens use Bearer.
    const upstreamOpts = hasQueryToken
      ? {}
      : {
          headers: {
            Authorization: `Bearer ${userToken}`,
          },
        }

    const upstreamWs = new WebSocket(upstreamUrl, subprotocol, upstreamOpts)

    clientWs.on('message', (data, isBinary) => {
      if (upstreamWs.readyState === WebSocket.OPEN) {
        upstreamWs.send(data, { binary: isBinary })
      }
    })

    upstreamWs.on('message', (data, isBinary) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary })
      }
    })

    upstreamWs.on('open', () => {
      console.log('[WS Proxy] Upstream connection established')
    })

    const cleanup = (reason) => {
      console.log(`[WS Proxy] Cleaning up: ${reason}`)
      if (upstreamWs.readyState === WebSocket.OPEN) {
        upstreamWs.close()
      }
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close()
      }
    }

    clientWs.on('error', (err) => {
      console.error('[WS Proxy] Client WebSocket error:', err)
      cleanup('client error')
    })

    upstreamWs.on('error', (err) => {
      console.error('[WS Proxy] Upstream WebSocket error:', err)
      cleanup('upstream error')
    })

    clientWs.on('close', () => {
      cleanup('client closed')
    })

    upstreamWs.on('close', () => {
      cleanup('upstream closed')
    })
  })
})

const PORT = process.env.PORT || 3000

httpServer.listen(PORT, () => {
  console.log(`> Ready on port ${PORT}`)
  console.log(`> WebSocket proxy: ${WS_PREFIX} → ${STDB_HOST}`)
  console.log(`> Module: ${STDB_MODULE}`)
})
