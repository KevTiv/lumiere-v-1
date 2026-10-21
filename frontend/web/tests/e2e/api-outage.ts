import { execFileSync } from "node:child_process"

type RunCommand = (command: string, args: string[]) => unknown

/** Control only the API dependency owned by the disposable E2E harness. */
export function readApiOutageControl(
  env: Readonly<Record<string, string | undefined>> = process.env,
  run: RunCommand = execFileSync,
): { stop: () => void; start: () => void } {
  if (env.E2E_API_OUTAGE_MODE === "loopback-reject") {
    if (
      env.GITHUB_ACTIONS !== "true" ||
      env.CI !== "true" ||
      env.LUMIERE_API_SERVER_URL !== "http://127.0.0.1:8082"
    ) {
      throw new Error("Loopback API outage requires the disposable GitHub CI API at http://127.0.0.1:8082")
    }
    // Reject only this runner's native API traffic. The exact same rule is
    // removed in finally; no service restart, route mock or global flush occurs.
    const rule = [
      "-d", "127.0.0.1/32", "-p", "tcp", "--dport", "8082",
      "-m", "comment", "--comment", "lumiere-e2e-api-outage",
      "-j", "REJECT", "--reject-with", "tcp-reset",
    ]
    return {
      stop: () => { run("sudo", ["-n", "iptables", "-w", "5", "-I", "OUTPUT", "1", ...rule]) },
      start: () => { run("sudo", ["-n", "iptables", "-w", "5", "-D", "OUTPUT", ...rule]) },
    }
  }
  if (env.E2E_API_OUTAGE_MODE && env.E2E_API_OUTAGE_MODE !== "docker") {
    throw new Error(`Unknown E2E API outage mode: ${env.E2E_API_OUTAGE_MODE}`)
  }
  const container = env.E2E_API_CONTAINER ?? "lumiere-dev-api-server-1"
  return {
    stop: () => { run("docker", ["stop", "--time", "2", container]) },
    start: () => { run("docker", ["start", container]) },
  }
}
