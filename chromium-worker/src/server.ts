import http from "node:http";
import puppeteer from "puppeteer-core";
import { checkBrowserReady } from "./readiness.mjs";

const PORT = Number(process.env.PORT ?? 8090);
const EXECUTABLE_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ??
  process.env.CHROME_EXECUTABLE_PATH ??
  undefined;

/** @type {Promise<import("puppeteer-core").Browser> | undefined} */
let browserPromise: Promise<import("puppeteer-core").Browser>;

async function launchBrowser() {
  if (!EXECUTABLE_PATH) {
    throw new Error(
      "PUPPETEER_EXECUTABLE_PATH is required (install Chromium in the container image)",
    );
  }
  return puppeteer.launch({
    executablePath: EXECUTABLE_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
    ],
  });
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = launchBrowser();
  }
  return browserPromise;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<any>}
 */
async function readJsonBody(req: http.IncomingMessage) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

/**
 * @param {{ html?: string; filename?: string; media?: string }} body
 * @returns {Promise<Buffer>}
 */
type Body = { html?: string; filename?: string; media?: string }

function safeFilename(value: string | undefined): string {
  const cleaned = (value?.trim() || "report.pdf").replace(/[^A-Za-z0-9._-]/g, "_")
  return cleaned.endsWith(".pdf") ? cleaned : `${cleaned}.pdf`
}

async function renderPdf(body: Body) {
  const html = body.html?.trim();
  if (!html) {
    throw new Error("html is required");
  }
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.emulateMediaType(body.media === "screen" ? "screen" : "print");
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "16mm", right: "12mm", bottom: "16mm", left: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "chromium-worker-v1" }));
      return;
    }

    if (req.method === "GET" && req.url === "/health/ready") {
      try {
        await checkBrowserReady(getBrowser);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, service: "chromium-worker-v1", ready: true }));
      } catch {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "not ready" }));
      }
      return;
    }

    if (req.method === "POST" && req.url === "/v1/render/pdf") {
      const body = await readJsonBody(req);
      const pdf = await renderPdf(body);
      const filename = safeFilename(body.filename);
      res.writeHead(200, {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${filename}"`,
        "cache-control": "no-store",
      });
      res.end(pdf);
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
});

server.listen(PORT, () => {
  console.log(`chromium-worker listening on ${PORT}`);
});

process.on("SIGTERM", async () => {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
  }
  server.close(() => process.exit(0));
});
