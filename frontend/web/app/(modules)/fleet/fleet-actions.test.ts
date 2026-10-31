import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { parseStrictU64 } from "@lumiere/erp-shared/u64";
import * as requestModel from "./fleet-request";

type Input = {
  clientRequestId: string;
  assertScope: () => void;
  inspectorId?: bigint;
};
const values = {
  vehicle_id: "41",
  service_type_id: "12",
  cost_amount: 250,
  journal_id: "2",
  expense_account_id: "3",
  offset_account_id: "4",
  notes: "Garage invoice 21",
};

/** Executes the production hook with isolated browser/session boundaries. */
function harness(
  storage = new Map<string, string>(),
  execute: (input: Input) => Promise<unknown> = async () => undefined,
  employeeIds: string[] = [],
) {
  const effects: Array<() => (() => void) | void> = [];
  const refs: Array<{ current: unknown }> = [];
  const states: unknown[] = [];
  let refIndex = 0;
  let stateIndex = 0;
  let uuid = 0;
  const calls: Input[] = [];
  const driverCalls: Array<{ vehicleId: bigint; driverId: bigint | null }> = [];
  const session = { identity: "actor", organizationId: 7 };
  let permitted = true;
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  };
  const hooks = {
    useCreateFleetVehicle: () => ({
      isPending: false,
      mutateAsync: async () => undefined,
    }),
    useUpdateFleetVehicleDriver: () => ({
      isPending: false,
      mutateAsync: async (input: {
        vehicleId: bigint;
        driverId: bigint | null;
      }) => {
        driverCalls.push(input);
      },
    }),
    useRecordFleetService: () => ({
      isPending: false,
      mutateAsync: async (input: Input) => {
        calls.push(input);
        return execute(input);
      },
    }),
    useRecordFleetInspection: () => ({
      isPending: false,
      mutateAsync: async (input: Input) => {
        calls.push(input);
        return execute(input);
      },
    }),
  };
  const dependencies: Record<string, unknown> = {
    react: {
      useRef: (initial: unknown) => {
        const index = refIndex++;
        return (refs[index] ??= { current: initial });
      },
      useState: (initial: unknown) => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [
          states[index],
          (value: unknown) => {
            states[index] = value;
          },
        ];
      },
      useEffect: (effect: () => (() => void) | void) => {
        effects.push(effect);
      },
    },
    "@lumiere/erp-session": { useErpSession: () => session },
    "@lumiere/erp-shared/u64": { parseStrictU64 },
    "@lumiere/ui/lib/rbac-context": {
      useRBAC: () => ({
        checkPermission: () => ({ allowed: permitted }),
        permissionsReady: true,
      }),
    },
    "@lumiere/query-hooks/hooks/fleet": hooks,
    "./fleet-request": requestModel,
  };
  const exports: Record<string, unknown> = {};
  const compiled = ts.transpileModule(
    readFileSync(new URL("./fleet-actions.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`);
      return dependencies[name];
    },
    window: { localStorage, addEventListener() {}, removeEventListener() {} },
    crypto: { randomUUID: () => `request-${++uuid}` },
  });
  const hook = exports.useFleetActions as (
    orgId: bigint,
    companyId: bigint,
    employeeIds: string[],
  ) => {
    submit: (action: string, values: Record<string, unknown>) => Promise<void>;
    recovery: requestModel.FleetHistoryAttempt | null;
  };
  const render = () => {
    refIndex = 0;
    stateIndex = 0;
    return hook(7n, 8n, employeeIds);
  };
  const result = render();
  const cleanups = effects.map((effect) => effect());
  return {
    result,
    render,
    calls,
    driverCalls,
    storage,
    session,
    localStorage,
    deny: () => {
      permitted = false;
    },
    unmount: () => cleanups.forEach((cleanup) => cleanup?.()),
  };
}

test("actual service submit survives lost reply/reload and reuses the stored identity and payload", async () => {
  const first = harness(undefined, async () => {
    throw new Error("lost response");
  });
  await assert.rejects(
    first.result.submit("recordFleetService", values),
    /lost response/,
  );
  const key = first.calls[0]!.clientRequestId;
  assert.equal(first.storage.size, 1);
  first.unmount();
  const reloaded = harness(first.storage);
  await reloaded.result.submit("recordFleetService", values);
  assert.equal(reloaded.calls[0]!.clientRequestId, key);
  assert.equal(reloaded.storage.size, 0);
});

test("actual service submit refuses changed values while the prior result is unresolved", async () => {
  const owner = harness(undefined, async () => {
    throw new Error("lost response");
  });
  await assert.rejects(owner.result.submit("recordFleetService", values));
  await assert.rejects(
    owner.result.submit("recordFleetService", { ...values, cost_amount: 251 }),
    /unresolved/,
  );
  assert.equal(owner.calls.length, 1);
});

test("held preread cannot dispatch after its action owner unmounts", async () => {
  let release!: () => void;
  const preread = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  const owner = harness(undefined, async (input) => {
    await preread;
    input.assertScope();
    posts++;
  });
  const pending = owner.result.submit("recordFleetService", values);
  owner.unmount();
  release();
  await assert.rejects(pending, /original company/);
  assert.equal(posts, 0);
  assert.equal(owner.storage.size, 1);
});

test("held preread cannot dispatch after actor changes or write permission is revoked", async () => {
  for (const change of ["actor", "permission"]) {
    let release!: () => void;
    const preread = new Promise<void>((resolve) => {
      release = resolve;
    });
    let posts = 0;
    const owner = harness(undefined, async (input) => {
      await preread;
      input.assertScope();
      posts++;
    });
    const pending = owner.result.submit("recordFleetService", values);
    if (change === "actor") owner.session.identity = "other";
    else owner.deny();
    owner.render();
    release();
    await assert.rejects(pending);
    assert.equal(posts, 0);
  }
});

test("storage failure and unsupported actions never dispatch", async () => {
  const owner = harness();
  owner.localStorage.setItem = () => {
    throw new Error("storage unavailable");
  };
  await assert.rejects(
    owner.result.submit("recordFleetService", values),
    /storage unavailable/,
  );
  await assert.rejects(
    owner.result.submit("unknownFleetCommand", values),
    /Unsupported/,
  );
  assert.equal(owner.calls.length, 0);
});

test("unavailable HR permits no-inspector inspections and unassignment but rejects employee selections", async () => {
  const owner = harness();
  await owner.result.submit("recordFleetInspection", {
    vehicle_id: "41",
    inspector_id: "none",
    outcome: "passed",
  });
  assert.equal(owner.calls[0]!.inspectorId, undefined);
  await owner.result.submit("assignFleetDriver", {
    vehicle_id: "41",
    driver_id: "unassigned",
  });
  assert.equal(owner.driverCalls[0]!.driverId, null);
  await assert.rejects(
    owner.result.submit("recordFleetInspection", {
      vehicle_id: "41",
      inspector_id: "12",
      outcome: "passed",
    }),
    /Employee choices/,
  );
  await assert.rejects(
    owner.result.submit("assignFleetDriver", {
      vehicle_id: "41",
      driver_id: "12",
    }),
    /Employee choices/,
  );
  assert.equal(owner.calls.length, 1);
  assert.equal(owner.driverCalls.length, 1);
});

test("available employee selections remain supported and revocation during inspection preread stops dispatch", async () => {
  const owner = harness(undefined, undefined, ["12"]);
  await owner.result.submit("assignFleetDriver", {
    vehicle_id: "41",
    driver_id: "12",
  });
  assert.equal(owner.driverCalls[0]!.driverId, 12n);
  let release!: () => void;
  const preread = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  const employeeIds = ["12"];
  const inspection = harness(
    undefined,
    async (input) => {
      await preread;
      input.assertScope();
      posts++;
    },
    employeeIds,
  );
  const pending = inspection.result.submit("recordFleetInspection", {
    vehicle_id: "41",
    inspector_id: "12",
    outcome: "passed",
  });
  employeeIds.length = 0;
  inspection.render();
  release();
  await assert.rejects(pending, /Employee choices/);
  assert.equal(posts, 0);
});
