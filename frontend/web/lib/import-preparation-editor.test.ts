import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"
import {
  canSavePreparationRecipe,
  editablePreparationTextFields,
  identityPreparationFields,
  nextPreparationSectionKey,
  preparationForSources,
  preparationHasChanges,
  preparationTargetFields,
  prunePreparationSection,
  recipeMatchesPreparation,
  savedPreparationRules,
} from "./import-preparation-editor"
import {
  importPreparationTextFields,
  type ImportPreparationSection,
  type ImportRecipe,
} from "./import-preparation"
import type { ChatImportTask } from "./chat-import-task"

const section: ImportPreparationSection = {
  key: "expenses",
  headerRecord: 1,
  firstRecord: 2,
  lastRecord: 4,
  targetEntity: "source_observation",
  expectedHeaders: ["Reference", "Igikorwa", "Amafaranga", "Unit"],
  headerMap: {
    Reference: "document_reference",
    Igikorwa: "category",
    Amafaranga: "amount",
    Unit: "unit",
  },
  identityNamespace: "legacy-shop",
  identityFields: ["document_reference"],
  aliases: [{ field: "category", from: "umuriro", to: "electricity" }],
  transforms: [{ field: "category", operation: "trim" }],
}

function task(): ChatImportTask {
  const requestId = "a".repeat(32)
  const sha256 = "b".repeat(64)
  return {
    requestId,
    companyId: "2",
    conversationKey: "original",
    status: "needs_review",
    error: null,
    warnings: [],
    createdAt: "2026-11-07T11:00:00Z",
    decision: {
      id: `${requestId}:purpose`,
      revision: 2,
      status: "approved",
      question: "Prepare?",
      allowOther: true,
      options: [{ id: "prepare_import", label: "Prepare" }],
      selectedOptionId: "prepare_import",
      otherText: null,
      decisionId: "c".repeat(32),
    },
    decisionReceipt: null,
    decisionHistory: [],
    files: [
      { fileName: "expenses.csv", ordinal: 0, sha256, size: 100 },
      { fileName: "other.csv", ordinal: 1, sha256: "c".repeat(64), size: 10 },
    ],
    reviews: [],
    preparation: {
      version: 1,
      files: [
        {
          fileName: "expenses.csv",
          sourceSha256: sha256,
          dateOrder: "dmy",
          sections: [section],
        },
      ],
    },
    coverage: {
      version: 1,
      complete: true,
      reconciliation: [],
      files: [
        {
          fileName: "expenses.csv",
          sourceSha256: sha256,
          byteCount: 100,
          status: "prepared",
          worksheet: null,
          recordCount: 4,
          reviewRecords: 3,
          headerRecords: 1,
          blankRecords: 0,
          records: [],
          error: null,
          layoutSha256: "d".repeat(64),
          sections: [
            {
              key: "expenses",
              targetEntity: "source_observation",
              headerRecord: 1,
              firstRecord: 2,
              lastRecord: 4,
              firstColumn: 1,
              lastColumn: 4,
              headerSha256: "e".repeat(64),
            },
          ],
        },
      ],
    },
  }
}

test("named field menus exactly match the actual worker's bounded preparation contracts", () => {
  const worker = fileURLToPath(
    new URL("../../../scripts/import-task-prepare.py", import.meta.url),
  )
  const result = JSON.parse(
    execFileSync(
      "python3",
      [
        "-B",
        "-I",
        "-c",
        "import importlib.util,json,sys; s=importlib.util.spec_from_file_location('worker',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps({'targets':{**{k:sorted(v) for k,v in m.TARGET_FIELDS.items()},'source_observation':sorted(m.rules.OBSERVATION_FIELDS)},'text':sorted(m.rules.TEXT_RULE_FIELDS)}))",
        worker,
      ],
      { encoding: "utf8" },
    ),
  )
  for (const [target, fields] of Object.entries(preparationTargetFields))
    assert.deepEqual([...fields].sort(), result.targets[target])
  assert.deepEqual([...importPreparationTextFields].sort(), result.text)
})

test("label and identity controls never offer amounts, units or payment confirmation", () => {
  assert.deepEqual(editablePreparationTextFields(section).sort(), [
    "category",
    "document_reference",
  ])
  assert.deepEqual(identityPreparationFields(section), ["document_reference"])
  assert.ok(
    !Object.values(preparationTargetFields)
      .flat()
      .includes("payment_verified" as never),
  )
})

test("changing source meanings removes incompatible aliases and identities", () => {
  const changed = prunePreparationSection({
    ...section,
    headerMap: {
      ...section.headerMap,
      Reference: "description",
      Igikorwa: "reported_method",
    },
  })
  assert.deepEqual(changed.aliases, [])
  assert.deepEqual(changed.transforms, [])
  assert.deepEqual(changed.identityFields, [])
  assert.equal(changed.identityNamespace, undefined)
})

test("recipe saves distinguish unsaved editor changes and exclude unconfigured files", () => {
  const saved = task()
  const rules = savedPreparationRules(saved)
  const unchanged = preparationForSources(saved, rules)
  assert.ok(unchanged.success)
  assert.equal(unchanged.data.files.length, 1)
  assert.equal(preparationHasChanges(saved, unchanged.data), false)
  const changed = preparationForSources(saved, {
    ...rules,
    "expenses.csv": { ...rules["expenses.csv"], dateOrder: "mdy" },
  })
  assert.ok(changed.success)
  assert.equal(preparationHasChanges(saved, changed.data), true)
  assert.equal(
    saved.preparation!.files[0]!.dateOrder,
    "dmy",
    "editing does not rewrite the saved task",
  )
  assert.equal(canSavePreparationRecipe(saved), true)
  saved.coverage!.complete = false
  assert.equal(canSavePreparationRecipe(saved), false)
})

test("an unchanged saved recipe does not need another version", () => {
  const saved = task()
  const recipe: ImportRecipe = {
    companyId: "2",
    key: "shop",
    name: "Shop",
    version: 1,
    sha256: "f".repeat(64),
    createdAt: "now",
    slots: [
      {
        key: "source-1",
        label: "expenses.csv",
        format: "csv",
        options: {
          ...savedPreparationRules(saved)["expenses.csv"],
          expectedLayoutSha256: "d".repeat(64),
        },
      },
    ],
  }
  assert.equal(recipeMatchesPreparation(recipe, saved), true)
  recipe.slots[0]!.options.dateOrder = "mdy"
  assert.equal(recipeMatchesPreparation(recipe, saved), false)
})

test("deleting and adding sections does not reuse an existing section key", () => {
  assert.equal(
    nextPreparationSectionKey([
      { ...section, key: "section-1" },
      { ...section, key: "section-3" },
    ]),
    "section-2",
  )
})
