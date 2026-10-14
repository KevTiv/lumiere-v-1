import { spawn } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const CONTRACT_SERVICE = "lumiere-contracts"

export function readContractCheckConfig(env = process.env) {
  const url = env.LUMIERE_CONTRACTS_URL?.trim()
  const expectedVersion = env.LUMIERE_CONTRACTS_EXPECTED_VERSION?.trim()
  const isRailway = Boolean(env.RAILWAY_ENVIRONMENT_ID)

  if (!url && !expectedVersion && !isRailway) return null
  if (!url) throw new Error("LUMIERE_CONTRACTS_URL is required on Railway")
  if (!expectedVersion) throw new Error("LUMIERE_CONTRACTS_EXPECTED_VERSION is required on Railway")

  return { url: url.replace(/\/+$/, ""), expectedVersion }
}

export async function verifyContractsService(
  { url, expectedVersion },
  {
    fetchImpl = globalThis.fetch,
    attempts = 12,
    requestTimeoutMs = 5_000,
    retryDelayMs = 2_500,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    logger = console,
  } = {},
) {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${url}/`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(requestTimeoutMs),
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const payload = await response.json()
      if (payload?.service !== CONTRACT_SERVICE) {
        throw new Error(`unexpected service ${JSON.stringify(payload?.service)}`)
      }
      if (payload?.status !== "ok") {
        throw new Error(`unexpected status ${JSON.stringify(payload?.status)}`)
      }
      if (payload?.version !== expectedVersion) {
        throw new Error(
          `version mismatch: expected ${expectedVersion}, received ${JSON.stringify(payload?.version)}`,
        )
      }

      return payload
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < attempts) {
        logger.warn(
          `[contracts-check] attempt ${attempt}/${attempts} failed: ${lastError.message}; retrying`,
        )
        await sleep(retryDelayMs)
      }
    }
  }

  throw new Error(`contracts service validation failed after ${attempts} attempts: ${lastError?.message}`)
}

async function startNext() {
  const nextBinary = fileURLToPath(new URL("../node_modules/.bin/next", import.meta.url))
  const child = spawn(nextBinary, ["start", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  })

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal))
  }

  await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      process.exitCode = code ?? (signal === "SIGTERM" ? 143 : signal === "SIGINT" ? 130 : 1)
      resolve()
    })
  })
}

export async function main() {
  const config = readContractCheckConfig()
  if (config) {
    const payload = await verifyContractsService(config)
    console.log(`[contracts-check] ${payload.service}@${payload.version} verified over Railway private networking`)
  }
  await startNext()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[contracts-check] startup blocked: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  })
}
