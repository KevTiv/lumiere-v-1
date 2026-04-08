import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer, WebSocket } from 'ws'

const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })
const handle = app.getRequestHandler()

/** Same-origin browser path; forwarded to Rust api-server WebSocket. */
const REALTIME_WS_PATH = '/api/realtime/ws'

function apiServerWsRealtimeUrl() {
  const raw = (process.env.LUMIERE_API_SERVER_URL || 'http://127.0.0.1:8082').replace(/\/$/, '')
  const u = new URL(raw)
  const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProto}//${u.host}/v1/realtime/ws`
}

await app.prepare()

const nextUpgrade = app.getUpgradeHandler()

const httpServer = createServer((req, res) => {
  handle(req, res, parse(req.url, true))
})

const wss = new WebSocketServer({ noServer: true })

httpServer.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url || '/', 'http://localhost')
  const pathname = u.pathname

  if (pathname !== REALTIME_WS_PATH) {
    void nextUpgrade(req, socket, head).catch((err) => {
      console.error('[Next] WebSocket upgrade failed:', err)
      socket.destroy()
    })
    return
  }

  const upstreamUrl = apiServerWsRealtimeUrl()
  const subprotocol = req.headers['sec-websocket-protocol']

  const headers = {}
  if (req.headers.cookie) {
    headers.Cookie = req.headers.cookie
  }
  if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization
  }
  if (req.headers['x-stdb-identity']) {
    headers['x-stdb-identity'] = req.headers['x-stdb-identity']
  }

  console.log(`[realtime proxy] Upgrade → ${upstreamUrl}`)

  wss.handleUpgrade(req, socket, head, (clientWs) => {
    const upstreamWs = new WebSocket(upstreamUrl, subprotocol, { headers })

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
      console.log('[realtime proxy] Upstream connection established')
    })

    const cleanup = (reason) => {
      console.log(`[realtime proxy] Cleaning up: ${reason}`)
      if (upstreamWs.readyState === WebSocket.OPEN) {
        upstreamWs.close()
      }
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close()
      }
    }

    clientWs.on('error', (err) => {
      console.error('[realtime proxy] Client WebSocket error:', err)
      cleanup('client error')
    })

    upstreamWs.on('error', (err) => {
      console.error('[realtime proxy] Upstream WebSocket error:', err)
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
  console.log(`> Realtime WebSocket proxy: ${REALTIME_WS_PATH} → ${apiServerWsRealtimeUrl()}`)
})
