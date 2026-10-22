import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

export function cacheKey(webRoot, platform = process.platform, arch = process.arch) {
  const require = createRequire(path.join(webRoot, "package.json"))
  const testFile = require.resolve("@playwright/test/package.json")
  const playwrightFile = createRequire(testFile).resolve("playwright/package.json")
  const coreFile = createRequire(playwrightFile).resolve("playwright-core/package.json")
  const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"))
  const manifest = read(path.join(path.dirname(coreFile), "browsers.json"))
  const browsers = manifest.browsers.filter((browser) =>
    ["chromium", "chromium-headless-shell", "ffmpeg"].includes(browser.name))
  if (!browsers.some((browser) => browser.name === "chromium") ||
      browsers.some((browser) => !browser.revision)) {
    throw new Error("Chromium revision is missing from the installed Playwright manifest")
  }
  const identity = { platform, arch, test: read(testFile).version,
    core: read(coreFile).version, browsers }
  const digest = createHash("sha256").update(JSON.stringify(identity)).digest("hex")
  return `playwright-chromium-v2-${platform}-${arch}-${digest}`
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const key = cacheKey(process.cwd())
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required")
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `key=${key}\n`)
  console.log(key)
}
