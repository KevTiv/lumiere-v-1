import assert from "node:assert/strict"
import test from "node:test"
import { readApiOutageControl } from "./api-outage"

test("native CI outage rejects only the owned loopback API and removes that exact rule", () => {
  const commands: Array<[string, string[]]> = []
  const control = readApiOutageControl({
    E2E_API_OUTAGE_MODE: "loopback-reject",
    GITHUB_ACTIONS: "true",
    CI: "true",
    LUMIERE_API_SERVER_URL: "http://127.0.0.1:8082",
  }, (command, args) => { commands.push([command, args]) })
  control.stop()
  control.start()
  assert.equal(commands.length, 2)
  const [insert, remove] = commands
  assert.equal(insert[0], "sudo")
  assert.equal(remove[0], "sudo")
  assert.deepEqual(insert[1].slice(0, 7), ["-n", "iptables", "-w", "5", "-I", "OUTPUT", "1"])
  assert.deepEqual(remove[1].slice(0, 6), ["-n", "iptables", "-w", "5", "-D", "OUTPUT"])
  assert.deepEqual(insert[1].slice(7), remove[1].slice(6))
  assert.deepEqual(remove[1].slice(6), [
    "-d", "127.0.0.1/32", "-p", "tcp", "--dport", "8082",
    "-m", "comment", "--comment", "lumiere-e2e-api-outage",
    "-j", "REJECT", "--reject-with", "tcp-reset",
  ])
})

test("native network faults fail closed outside the exact disposable CI target", () => {
  const allowed = {
    E2E_API_OUTAGE_MODE: "loopback-reject", GITHUB_ACTIONS: "true", CI: "true",
    LUMIERE_API_SERVER_URL: "http://127.0.0.1:8082",
  }
  for (const change of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" },
    { LUMIERE_API_SERVER_URL: "https://api.example.com" },
    { LUMIERE_API_SERVER_URL: "http://127.0.0.1:5432" },
  ]) {
    assert.throws(() => readApiOutageControl({ ...allowed, ...change }), /disposable GitHub CI API/)
  }
  assert.throws(() => readApiOutageControl({ E2E_API_OUTAGE_MODE: "unknown" }), /Unknown E2E API outage mode/)
})

test("local Docker outage retains its explicit container and stop/start behavior", () => {
  const commands: Array<[string, string[]]> = []
  const control = readApiOutageControl({ E2E_API_CONTAINER: "owned-test-api" }, (command, args) => { commands.push([command, args]) })
  control.stop()
  control.start()
  assert.deepEqual(commands, [["docker", ["stop", "--time", "2", "owned-test-api"]], ["docker", ["start", "owned-test-api"]]])
})
