#!/usr/bin/env node
// Local TLS terminator for WorkOS-mode acceptance: https://localhost:3443 -> http://127.0.0.1:3001.
// Self-signed certificate under .tmp/workos (gitignored); browsers/Playwright must accept it.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import http from "node:http"
import https from "node:https"

const dir = ".tmp/workos"
const key = `${dir}/localhost-key.pem`
const cert = `${dir}/localhost-cert.pem`
mkdirSync(dir, { recursive: true })
if (!existsSync(key) || !existsSync(cert)) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert,
    "-days", "30", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" })
}
const target = { host: "127.0.0.1", port: 3001 }
https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
  const upstream = http.request({ ...target, method: req.method, path: req.url,
    headers: { ...req.headers, host: "localhost:3443", "x-forwarded-proto": "https", "x-forwarded-host": "localhost:3443" } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers)
    r.pipe(res)
  })
  upstream.on("error", () => { res.writeHead(502); res.end("upstream unavailable") })
  req.pipe(upstream)
}).listen(3443, "127.0.0.1", () => console.log("https://localhost:3443 -> http://127.0.0.1:3001"))
