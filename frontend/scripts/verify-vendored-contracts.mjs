import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const consumerManifests = [
  "packages/presentation-core/package.json",
  "packages/query-hooks/package.json",
  "packages/stdb/package.json",
]

const pins = consumerManifests.map((relativePath) => {
  const manifestPath = resolve(frontendRoot, relativePath)
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const specifier = manifest.dependencies?.["@lumiere/contracts"]

  if (!specifier?.startsWith("file:")) {
    throw new Error(`${relativePath} must pin @lumiere/contracts to a vendored file`)
  }

  return {
    relativePath,
    specifier,
    tarballPath: resolve(dirname(manifestPath), specifier.slice("file:".length)),
  }
})

const expectedSpecifier = pins[0].specifier
for (const pin of pins) {
  if (pin.specifier !== expectedSpecifier) {
    throw new Error(
      `${pin.relativePath} uses ${pin.specifier}; expected the shared pin ${expectedSpecifier}`,
    )
  }
  if (!statSync(pin.tarballPath).isFile()) {
    throw new Error(`${pin.relativePath} references missing tarball ${pin.tarballPath}`)
  }
}

const tarballPath = pins[0].tarballPath
const filenameMatch = /^lumiere-contracts-(.+)\.tgz$/.exec(basename(tarballPath))
if (!filenameMatch) {
  throw new Error(`unexpected contracts tarball name: ${basename(tarballPath)}`)
}

const packageManifest = JSON.parse(
  execFileSync("tar", ["-xOf", tarballPath, "package/package.json"], { encoding: "utf8" }),
)
if (packageManifest.name !== "@lumiere/contracts") {
  throw new Error(`vendored tarball contains unexpected package ${JSON.stringify(packageManifest.name)}`)
}
if (packageManifest.version !== filenameMatch[1]) {
  throw new Error(
    `vendored tarball version ${packageManifest.version} does not match filename ${filenameMatch[1]}`,
  )
}

const lockfile = readFileSync(resolve(frontendRoot, "pnpm-lock.yaml"), "utf8")
if (!lockfile.includes(`specifier: ${expectedSpecifier}`)) {
  throw new Error(`pnpm-lock.yaml does not record ${expectedSpecifier}`)
}
const snapshotSpecifier = expectedSpecifier.replace(/^file:\.\.\/\.\.\//, "file:")
const snapshotStart = lockfile.indexOf(`'@lumiere/contracts@${snapshotSpecifier}':`)
if (snapshotStart === -1) {
  throw new Error(`pnpm-lock.yaml has no package snapshot for ${snapshotSpecifier}`)
}
if (!lockfile.slice(snapshotStart, snapshotStart + 400).includes("integrity: sha512-")) {
  throw new Error(`pnpm-lock.yaml has no integrity hash for ${snapshotSpecifier}`)
}

console.log(
  `@lumiere/contracts@${packageManifest.version} vendored pin verified for ${pins.length} consumers`,
)
