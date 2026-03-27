import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer, WebSocket } from 'ws'

const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })
const handle = app.getRequestHandler()

// SpacetimeDB configuration from private env vars (never exposed to browser)
const STDB_HOST = process.env.STDB_HOST || 'wss://maincloud.spacetimedb.com'
const STDB_MODULE = process.env.STDB_MODULE || 'lumiere-v1'
const WS_PATH = '/api/stdb'

await app.prepare()

const httpServer = createServer((req, res) => {
  handle(req, res, parse(req.url, true))
})

const wss = new WebSocketServer({ noServer: true })

httpServer.on('upgrade', (req, socket, head) => {
  const { pathname } = parse(req.url)

  // Only handle WebSocket upgrades for our proxy path
  if (pathname !== WS_PATH) {
    // Let Next.js handle other upgrade requests
    socket.destroy()
    return
  }

  // Extract user token from cookie header
  const cookieHeader = req.headers.cookie || ''
  const cookies = Object.fromEntries(
    cookieHeader.split(';').filter(Boolean).map(c => {
      const [key, ...value] = c.trim().split('=')
      return [key, value.join('=')]
    })
  )
  const userToken = cookies['stdb_token']

  if (!userToken) {
    console.warn('[WS Proxy] Rejected connection: no stdb_token cookie')
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  console.log('[WS Proxy] Handling upgrade for authenticated user')

  wss.handleUpgrade(req, socket, head, (clientWs) => {
    const subprotocol = req.headers['sec-websocket-protocol']

    // Build the upstream SpacetimeDB WebSocket URL
    const upstreamUrl = `${STDB_HOST}/v1/database/${STDB_MODULE}/subscribe`

    console.log(`[WS Proxy] Connecting upstream to: ${upstreamUrl}`)

    // Connect server-side to real SpacetimeDB with user's own token
    const upstreamWs = new WebSocket(
      upstreamUrl,
      subprotocol,
      {
        headers: {
          Authorization: `Bearer ${userToken}`
        }
      }
    )

    // Bidirectional pipe: client -> upstream
    clientWs.on('message', (data, isBinary) => {
      if (upstreamWs.readyState === WebSocket.OPEN) {
        upstreamWs.send(data, { binary: isBinary })
      }
    })

    // Bidirectional pipe: upstream -> client
    upstreamWs.on('message', (data, isBinary) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary })
      }
    })

    // Handle connection open
    upstreamWs.on('open', () => {
      console.log('[WS Proxy] Upstream connection established')
    })

    // Cleanup function to close both connections
    const cleanup = (reason) => {
      console.log(`[WS Proxy] Cleaning up: ${reason}`)
      if (upstreamWs.readyState === WebSocket.OPEN) {
        upstreamWs.close()
      }
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close()
      }
    }

    // Error handling
    clientWs.on('error', (err) => {
      console.error('[WS Proxy] Client WebSocket error:', err)
      cleanup('client error')
    })

    upstreamWs.on('error', (err) => {
      console.error('[WS Proxy] Upstream WebSocket error:', err)
      cleanup('upstream error')
    })

    // Close handling
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
  console.log(`> WebSocket proxy available at ws://localhost:${PORT}${WS_PATH}`)
  console.log(`> Upstream SpacetimeDB: ${STDB_HOST}`)
  console.log(`> Module: ${STDB_MODULE}`)
})
