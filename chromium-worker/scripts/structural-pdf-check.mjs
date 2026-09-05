import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.CHROMIUM_WORKER_URL ?? "http://127.0.0.1:8090";
const outputDir = process.env.PDF_STRUCTURAL_OUTPUT ?? await mkdtemp(join(tmpdir(), "lumiere-pdf-"));
await mkdir(outputDir, { recursive: true });

async function waitForReady(url, timeoutMs = 30_000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health/ready`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Chromium worker readiness failed after ${timeoutMs}ms: ${lastError}`);
}

const fixtures = [
  ["Daily Business Summary", "Sales"],
  ["Cash & Mobile Money", "Accounts"],
  ["Customer Balances", "Customer"],
  ["Supplier Payables", "Supplier"],
  ["Low Stock Report", "Product"],
  ["Stock Movement Report", "Destination"],
  ["Sales by Product", "Gross sales"],
  ["Purchase Spend", "Total spend"],
  ["Payment Fee Summary", "Fee groups"],
  ["Monthly Owner Report", "Stock movement value"],
];

function html(title, label, longTable = false) {
  const rows = Array.from({ length: longTable ? 180 : 4 }, (_, index) =>
    `<tr><td>${label} ${index + 1}</td><td>${(index + 1) * 100}</td></tr>`,
  ).join("");
  return `<!doctype html><html><head><style>@page { size:A4; margin:16mm 12mm; } body{font:12px Arial} table{width:100%;border-collapse:collapse} th,td{border:1px solid #999;padding:4px} thead{display:table-header-group}</style></head><body><h1>${title}</h1><p>Cutoff: 2026-07-12 UTC local day</p><p>Total: 400.00</p><table><thead><tr><th>${label}</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

await waitForReady(baseUrl);

for (const [index, [title, label]] of fixtures.entries()) {
  const response = await fetch(`${baseUrl}/v1/render/pdf`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: html(title, label, index === 5), filename: `${title}.pdf`, media: "print" }),
  });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("application/pdf")) {
    throw new Error(`${title}: renderer response contract failed (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error(`${title}: invalid PDF header`);
  const path = join(outputDir, `fixture-${index + 1}.pdf`);
  await writeFile(path, bytes);
  const text = execFileSync("pdftotext", [path, "-"], { encoding: "utf8" });
  for (const expected of [title, "Cutoff:", "Total:", label]) {
    if (!text.includes(expected)) throw new Error(`${title}: missing structural text '${expected}'`);
  }
  const pages = (bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
  if (pages < 1 || pages > 20) throw new Error(`${title}: unreasonable page count ${pages}`);
  if (index === 5 && pages < 2) throw new Error(`${title}: long table did not paginate`);
}

const malformed = await fetch(`${baseUrl}/v1/render/pdf`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
if (malformed.status !== 400) throw new Error("malformed JSON was not rejected");
const safeName = await fetch(`${baseUrl}/v1/render/pdf`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ html: "<h1>Safe</h1>", filename: 'unsafe\r\nname' }) });
if (!safeName.headers.get("content-disposition")?.includes("unsafe__name.pdf")) throw new Error("unsafe filename was not sanitized");

console.log(`validated ${fixtures.length} deterministic PDF fixtures in ${outputDir}`);
