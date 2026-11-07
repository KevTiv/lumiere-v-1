"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { apiFetch } from "./api-fetch"
import type { ChatImportTask } from "./chat-import-task"
import {
  type ImportCoverage,
  type ImportPreparationRules,
  type ImportPreparationSection,
} from "./import-preparation"
import {
  applyImportRecipe,
  listImportRecipes,
  reprepareImportTask,
  saveImportRecipe,
} from "./import-preparation-client"
import {
  ImportChoice as Choice,
  ImportTextField as TextField,
} from "./import-task-fields"
import {
  canSavePreparationRecipe,
  editablePreparationTextFields,
  identityPreparationFields,
  nextPreparationSectionKey,
  preparationFieldLabels,
  preparationForSources,
  preparationHasChanges,
  preparationTargetFields,
  prunePreparationSection,
  recipeMatchesPreparation,
  savedPreparationRules,
  type PreparationField,
} from "./import-preparation-editor"

interface Props {
  task: ChatImportTask
  organizationId: number
  companyId: number
  onPrepared: (task: ChatImportTask) => void
}

export function ImportPreparationPanel(props: Props) {
  const { identity } = useErpSession()
  return (
    <PreparationEditor
      key={`${identity}:${props.organizationId}:${props.companyId}:${props.task.requestId}`}
      {...props}
      actor={identity ?? ""}
    />
  )
}

function PreparationEditor({
  task,
  organizationId,
  companyId,
  onPrepared,
  actor,
}: Props & { actor: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const scope = { organizationId, actor, companyId, taskId: task.requestId }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const recipesKey = [
    "import-recipes",
    actor,
    organizationId,
    companyId,
  ] as const
  const recipes = useQuery({
    queryKey: recipesKey,
    queryFn: () => listImportRecipes(apiFetch, scope),
    enabled: !!actor,
  })
  const [selectedFile, setSelectedFile] = useState(task.files[0]!.fileName)
  const [rules, setRules] = useState<Record<string, ImportPreparationRules>>(
    () => savedPreparationRules(task),
  )
  const [recipeName, setRecipeName] = useState("")
  const [selectedRecipe, setSelectedRecipe] = useState("")
  const [bindings, setBindings] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const options = rules[selectedFile] ?? {}
  const availableRecipes = recipes.isError ? [] : (recipes.data ?? [])
  const recipe = availableRecipes.find((value) => value.key === selectedRecipe)
  const slug = recipeName
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  const recipeKey = (/^[a-z]/.test(slug) ? slug : `recipe-${slug}`).slice(
    0,
    100,
  )
  const existingRecipe = availableRecipes.find(
    (value) => value.key === recipeKey,
  )
  const parsed = preparationForSources(task, rules)
  const changedRules =
    !parsed.success || preparationHasChanges(task, parsed.data)
  const alreadySaved =
    existingRecipe?.name === recipeName.trim() &&
    recipeMatchesPreparation(existingRecipe, task)
  const change = (patch: Partial<ImportPreparationRules>) =>
    setRules((previous) => ({
      ...previous,
      [selectedFile]: {
        ...previous[selectedFile],
        expectedLayoutSha256: undefined,
        ...patch,
      },
    }))
  const operation = useMutation({
    mutationFn: async (action: "prepare" | "save" | "apply") => {
      setError(null)
      setNotice(null)
      if (action === "prepare") {
        if (!parsed.success)
          throw new Error(
            parsed.error.issues[0]?.message ??
              t("settings.importPreparation.checkRules", {
                defaultValue: "Check the source rules before preparing.",
              }),
          )
        const next = await reprepareImportTask(apiFetch, scope, parsed.data)
        if (mounted.current) onPrepared(next)
      } else if (action === "save") {
        await saveImportRecipe(apiFetch, scope, {
          key: recipeKey,
          name: recipeName,
          expectedVersion: existingRecipe?.version ?? 0,
        })
        await queryClient.invalidateQueries({ queryKey: recipesKey })
        if (mounted.current)
          setNotice(
            t("settings.importPreparation.recipeSaved", {
              defaultValue:
                "Recipe version saved. Applying it to another export will create a fresh source review.",
            }),
          )
      } else {
        if (!recipe)
          throw new Error(
            t("settings.importPreparation.chooseRecipe", {
              defaultValue: "Choose a saved recipe.",
            }),
          )
        const selected = recipe.slots.map((slot) => ({
          slotKey: slot.key,
          ordinal: Number(bindings[slot.key] ?? "-1"),
        }))
        const next = await applyImportRecipe(apiFetch, scope, recipe, selected)
        if (mounted.current) onPrepared(next)
      }
    },
    onError: (caught: Error) => {
      if (mounted.current) setError(caught.message)
    },
  })
  const canApply =
    recipe &&
    recipe.slots.every((slot) => bindings[slot.key] !== undefined) &&
    new Set(recipe.slots.map((slot) => bindings[slot.key])).size ===
      recipe.slots.length
  const canSave =
    canSavePreparationRecipe(task) &&
    !changedRules &&
    !alreadySaved &&
    /^[a-z][a-z0-9_-]{0,99}$/.test(recipeKey) &&
    recipeName.trim().length > 0
  const currentCoverage = task.coverage?.files.find(
    (file) => file.fileName === selectedFile,
  )

  return (
    <section
      className="space-y-3 rounded border p-4"
      data-testid="import-preparation-rules"
    >
      <h3 className="font-medium">
        {t("settings.importPreparation.title", {
          defaultValue: "Repeatable source preparation",
        })}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t("settings.importPreparation.boundary", {
          defaultValue:
            "Choose how to read the original files. Preparing with changed rules creates a new saved task; source facts and ERP approvals must be reviewed again.",
        })}
      </p>
      {task.coverage && (
        <p className="text-sm">
          {t(
            task.coverage.complete
              ? "settings.importPreparation.completeCoverage"
              : "settings.importPreparation.partialCoverage",
            {
              defaultValue: task.coverage.complete
                ? "Every source record is accounted for as review data, a header or a blank record."
                : "Some source files are held. Review their errors before treating the import as complete.",
            },
          )}
        </p>
      )}
      {task.coverage?.files.some((file) => file.error) && (
        <ul className="list-disc pl-5 text-sm">
          {task.coverage.files
            .filter((file) => file.error)
            .map((file) => (
              <li key={file.fileName}>
                {file.fileName}: {file.error}
              </li>
            ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <details>
        <summary className="cursor-pointer font-medium">
          {t("settings.importPreparation.editRules", {
            defaultValue: "Review language and layout rules",
          })}
        </summary>
        <fieldset disabled={operation.isPending} className="mt-3 space-y-4">
          <Choice
            label={t("settings.importPreparation.file", {
              defaultValue: "Source file",
            })}
            value={selectedFile}
            onChange={setSelectedFile}
            options={task.files.map((file) => ({
              value: file.fileName,
              label: file.fileName,
            }))}
          />
          {currentCoverage && (
            <SourceCoverage key={selectedFile} coverage={currentCoverage} />
          )}
          {options.expectedLayoutSha256 && (
            <div className="space-y-2 text-sm">
              <p>
                {t("settings.importPreparation.pinnedLayout", {
                  defaultValue:
                    "These rules are bound to a saved header layout. If the new export changed, check its original headers and edit the rules to prepare a new review.",
                })}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => change({ expectedLayoutSha256: undefined })}
              >
                {t("settings.importPreparation.reviewLayout", {
                  defaultValue: "Prepare with a newly reviewed layout",
                })}
              </Button>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Choice
              label={t("settings.importPreparation.delimiter", {
                defaultValue: "Column separator",
              })}
              value={options.delimiter ?? "detect"}
              onChange={(value) =>
                change({
                  delimiter:
                    value === "detect"
                      ? undefined
                      : (value as ImportPreparationRules["delimiter"]),
                })
              }
              options={[
                {
                  value: "detect",
                  label: t("settings.importPreparation.detect", {
                    defaultValue: "Use strict detection",
                  }),
                },
                {
                  value: ",",
                  label: t("settings.importPreparation.comma", {
                    defaultValue: "Comma",
                  }),
                },
                {
                  value: ";",
                  label: t("settings.importPreparation.semicolon", {
                    defaultValue: "Semicolon",
                  }),
                },
                {
                  value: "\t",
                  label: t("settings.importPreparation.tab", {
                    defaultValue: "Tab",
                  }),
                },
                {
                  value: "|",
                  label: t("settings.importPreparation.pipe", {
                    defaultValue: "Vertical bar",
                  }),
                },
              ]}
            />
            <Choice
              label={t("settings.importPreparation.decimal", {
                defaultValue: "Decimal separator",
              })}
              value={options.decimalSeparator ?? "strict"}
              onChange={(value) =>
                change({
                  decimalSeparator:
                    value === "strict" ? undefined : (value as "." | ","),
                  groupingSeparator: "none",
                })
              }
              options={[
                {
                  value: "strict",
                  label: t("settings.importPreparation.strictDecimal", {
                    defaultValue: "Keep ambiguous numbers for review",
                  }),
                },
                { value: ".", label: "1234.50" },
                { value: ",", label: "1234,50" },
              ]}
            />
            <Choice
              label={t("settings.importPreparation.grouping", {
                defaultValue: "Thousands separator",
              })}
              value={options.groupingSeparator ?? "none"}
              onChange={(value) =>
                change({
                  groupingSeparator:
                    value as ImportPreparationRules["groupingSeparator"],
                })
              }
              options={[
                {
                  value: "none",
                  label: t("settings.importPreparation.none", {
                    defaultValue: "None",
                  }),
                },
                { value: ".", label: "1.234" },
                { value: ",", label: "1,234" },
                { value: " ", label: "1 234" },
              ]}
            />
            <Choice
              label={t("settings.importPreparation.dateOrder", {
                defaultValue: "Source date order",
              })}
              value={options.dateOrder ?? "iso"}
              onChange={(value) =>
                change({
                  dateOrder: value as ImportPreparationRules["dateOrder"],
                })
              }
              options={[
                {
                  value: "iso",
                  label: t("settings.importPreparation.iso", {
                    defaultValue: "Year-month-day; hold ambiguous dates",
                  }),
                },
                {
                  value: "dmy",
                  label: t("settings.importPreparation.dmy", {
                    defaultValue: "Day / month / year",
                  }),
                },
                {
                  value: "mdy",
                  label: t("settings.importPreparation.mdy", {
                    defaultValue: "Month / day / year",
                  }),
                },
              ]}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {t("settings.importPreparation.sectionsHint", {
              defaultValue:
                "For a report with several tables, define each section and its exact headers. Records and cells outside the sections remain visible as evidence.",
            })}
          </p>
          {(options.sections ?? []).map((section, index) => (
            <SectionEditor
              key={`${selectedFile}:${index}`}
              section={section}
              onChange={(next) =>
                change({
                  sections: options.sections!.map((current, position) =>
                    position === index ? next : current,
                  ),
                })
              }
              onRemove={() =>
                change({
                  sections: options.sections!.filter(
                    (_, position) => position !== index,
                  ),
                })
              }
            />
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={(options.sections?.length ?? 0) >= 50}
            onClick={() =>
              change({
                sections: [
                  ...(options.sections ?? []),
                  {
                    key: nextPreparationSectionKey(options.sections ?? []),
                    headerRecord: 1,
                    firstRecord: 2,
                    lastRecord: Math.max(2, currentCoverage?.recordCount ?? 2),
                    targetEntity: "source_observation",
                    expectedHeaders: [""],
                  },
                ],
              })
            }
          >
            {t("settings.importPreparation.addSection", {
              defaultValue: "Add a source section",
            })}
          </Button>
          {!parsed.success && (
            <p className="text-sm" role="status">
              {parsed.error.issues[0]?.message}
            </p>
          )}
          <div>
            <Button
              disabled={!parsed.success || operation.isPending}
              onClick={() => operation.mutate("prepare")}
            >
              {t("settings.importPreparation.prepare", {
                defaultValue: "Prepare a new review with these rules",
              })}
            </Button>
          </div>
        </fieldset>
      </details>
      <details>
        <summary className="cursor-pointer font-medium">
          {t("settings.importPreparation.recipes", {
            defaultValue: "Save or reuse preparation recipes",
          })}
        </summary>
        <fieldset disabled={operation.isPending} className="mt-3 space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("settings.importPreparation.recipeHint", {
              defaultValue:
                "Recipes keep exact header and language rules. Changed layouts are held for review. They never carry forward confirmed facts or permission to create ERP records.",
            })}
          </p>
          {recipes.error && <p role="alert">{recipes.error.message}</p>}
          <TextField
            label={t("settings.importPreparation.recipeName", {
              defaultValue: "Recipe name",
            })}
            value={recipeName}
            onChange={setRecipeName}
            maxLength={100}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!canSave || operation.isPending || recipes.isError}
            onClick={() => operation.mutate("save")}
          >
            {existingRecipe
              ? t("settings.importPreparation.newVersion", {
                  defaultValue: "Save a new version",
                })
              : t("settings.importPreparation.saveRecipe", {
                  defaultValue: "Save current rules as a recipe",
                })}
          </Button>
          {(!canSavePreparationRecipe(task) || changedRules) && (
            <p className="text-sm">
              {t("settings.importPreparation.prepareFirst", {
                defaultValue:
                  "Prepare a new review with these explicit rules and resolve held layouts before saving the recipe.",
              })}
            </p>
          )}
          {alreadySaved && (
            <p className="text-sm">
              {t("settings.importPreparation.alreadySaved", {
                defaultValue:
                  "This recipe already contains the current saved rules.",
              })}
            </p>
          )}
          <Choice
            label={t("settings.importPreparation.savedRecipe", {
              defaultValue: "Saved recipe",
            })}
            value={selectedRecipe}
            onChange={(value) => {
              setSelectedRecipe(value)
              setBindings({})
            }}
            options={availableRecipes.map((current) => ({
              value: current.key,
              label: `${current.name} · v${current.version}`,
            }))}
          />
          {recipe?.slots.map((slot) => (
            <Choice
              key={slot.key}
              label={t("settings.importPreparation.matchFile", {
                defaultValue: "Current file for {{source}}",
                source: slot.label,
              })}
              value={bindings[slot.key] ?? ""}
              onChange={(value) =>
                setBindings((previous) => ({ ...previous, [slot.key]: value }))
              }
              options={task.files
                .filter((file) =>
                  file.fileName.toLowerCase().endsWith(`.${slot.format}`),
                )
                .map((file) => ({
                  value: String(file.ordinal),
                  label: file.fileName,
                }))}
            />
          ))}
          <Button
            disabled={!canApply || operation.isPending}
            onClick={() => operation.mutate("apply")}
          >
            {t("settings.importPreparation.applyRecipe", {
              defaultValue: "Apply recipe and create a fresh review",
            })}
          </Button>
        </fieldset>
      </details>
      {!!task.coverage?.reconciliation.length && (
        <ReconciliationCoverage
          key={task.requestId}
          groups={task.coverage.reconciliation}
        />
      )}
    </section>
  )
}

function SectionEditor({
  section,
  onChange,
  onRemove,
}: {
  section: ImportPreparationSection
  onChange: (next: ImportPreparationSection) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const headersId = useId()
  const change = (patch: Partial<ImportPreparationSection>) =>
    onChange({ ...section, ...patch })
  const fieldLabel = (field: PreparationField) =>
    t(`settings.importPreparation.fields.${field}`, {
      defaultValue: preparationFieldLabels[field],
    })
  return (
    <div className="space-y-3 rounded border p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <TextField
          label={t("settings.importPreparation.sectionName", {
            defaultValue: "Section name",
          })}
          value={section.key}
          onChange={(value) => change({ key: value })}
          maxLength={64}
        />
        <Choice
          label={t("settings.importPreparation.destination", {
            defaultValue: "Review destination",
          })}
          value={section.targetEntity}
          onChange={(value) => {
            const targetEntity =
              value as ImportPreparationSection["targetEntity"]
            const allowed = new Set<string>(
              preparationTargetFields[targetEntity],
            )
            onChange(
              prunePreparationSection({
                ...section,
                targetEntity,
                headerMap: Object.fromEntries(
                  Object.entries(section.headerMap ?? {}).filter(([, field]) =>
                    allowed.has(field),
                  ),
                ),
              }),
            )
          }}
          options={[
            {
              value: "source_observation",
              label: t("settings.importPreparation.observations", {
                defaultValue: "Historical source observations",
              }),
            },
            {
              value: "product",
              label: t("settings.importPreparation.products", {
                defaultValue: "Product records",
              }),
            },
            {
              value: "contact",
              label: t("settings.importPreparation.contacts", {
                defaultValue: "Contact records",
              }),
            },
            {
              value: "stock_location",
              label: t("settings.importPreparation.locations", {
                defaultValue: "Warehouse locations",
              }),
            },
          ]}
        />
        <TextField
          label={t("settings.importPreparation.headerRecord", {
            defaultValue: "Header record number",
          })}
          type="number"
          min={1}
          max={25000}
          value={String(section.headerRecord)}
          onChange={(value) => change({ headerRecord: Number(value) })}
        />
        <TextField
          label={t("settings.importPreparation.firstRecord", {
            defaultValue: "First data record",
          })}
          type="number"
          min={1}
          max={25000}
          value={String(section.firstRecord)}
          onChange={(value) => change({ firstRecord: Number(value) })}
        />
        <TextField
          label={t("settings.importPreparation.lastRecord", {
            defaultValue: "Last data record",
          })}
          type="number"
          min={1}
          max={25000}
          value={String(section.lastRecord)}
          onChange={(value) => change({ lastRecord: Number(value) })}
        />
        <TextField
          label={t("settings.importPreparation.firstColumn", {
            defaultValue: "First column number",
          })}
          type="number"
          min={1}
          max={200}
          value={String(section.firstColumn ?? 1)}
          onChange={(value) =>
            change({ firstColumn: Number(value), lastColumn: undefined })
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("settings.importPreparation.recordHint", {
          defaultValue:
            "Record numbers count logical rows in the saved file, including headers and blank records. Source coverage preserves the original worksheet or physical row numbers.",
        })}
      </p>
      <Field>
        <FieldLabel htmlFor={headersId}>
          {t("settings.importPreparation.headers", {
            defaultValue: "Exact header names, one per line",
          })}
        </FieldLabel>
        <Textarea
          id={headersId}
          value={section.expectedHeaders.join("\n")}
          onChange={(event) =>
            onChange(
              prunePreparationSection({
                ...section,
                expectedHeaders: event.target.value.split("\n"),
                lastColumn: undefined,
                headerMap: {},
              }),
            )
          }
        />
      </Field>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              {t("settings.importPreparation.sourceColumn", {
                defaultValue: "Source column",
              })}
            </TableHead>
            <TableHead>
              {t("settings.importPreparation.meaning", {
                defaultValue: "Business meaning",
              })}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {section.expectedHeaders.map((header, index) => (
            <TableRow key={`${index}:${header}`}>
              <TableCell>{header || "—"}</TableCell>
              <TableCell>
                <Choice
                  label={t("settings.importPreparation.mapColumn", {
                    defaultValue: "Meaning of {{column}}",
                    column: header || String(index + 1),
                  })}
                  value={section.headerMap?.[header] ?? "__source__"}
                  onChange={(value) => {
                    const mapping = { ...section.headerMap }
                    if (value !== "__source__") mapping[header] = value
                    else delete mapping[header]
                    onChange(
                      prunePreparationSection({
                        ...section,
                        headerMap: mapping,
                      }),
                    )
                  }}
                  options={[
                    {
                      value: "__source__",
                      label: t("settings.importPreparation.keepHeader", {
                        defaultValue: "Use the original header",
                      }),
                    },
                    ...preparationTargetFields[section.targetEntity].map(
                      (field) => ({ value: field, label: fieldLabel(field) }),
                    ),
                  ]}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        {t("settings.importPreparation.mappingHint", {
          defaultValue:
            "Choose each column's meaning from the list. Unrecognized columns remain source evidence. Changing a mapping removes label rules that no longer have a source column.",
        })}
      </p>
      <SectionReuseRules section={section} onChange={onChange} />
      <Button size="sm" variant="outline" onClick={onRemove}>
        {t("settings.importPreparation.removeSection", {
          defaultValue: "Remove this section",
        })}
      </Button>
    </div>
  )
}

function SectionReuseRules({
  section,
  onChange,
}: {
  section: ImportPreparationSection
  onChange: (next: ImportPreparationSection) => void
}) {
  const { t } = useTranslation()
  const fieldLabel = (field: PreparationField) =>
    t(`settings.importPreparation.fields.${field}`, {
      defaultValue: preparationFieldLabels[field],
    })
  const textFields = editablePreparationTextFields(section)
  const identityFields = identityPreparationFields(section)
  const selectedIdentities = section.identityFields ?? []
  const aliases = section.aliases ?? []
  const transforms = section.transforms ?? []
  return (
    <details className="space-y-3">
      <summary className="cursor-pointer text-sm font-medium">
        {t("settings.importPreparation.reuseRules", {
          defaultValue: "Record matching and label rules",
        })}
      </summary>
      <p className="text-xs text-muted-foreground">
        {t("settings.importPreparation.identityHint", {
          defaultValue:
            "Choose stable source references to compare changed exports from the same source system. Matching or conflicting rows stay held for review; they are never merged or excluded automatically.",
        })}
      </p>
      <TextField
        label={t("settings.importPreparation.identityNamespace", {
          defaultValue: "Source system or export family",
        })}
        value={section.identityNamespace ?? ""}
        maxLength={200}
        onChange={(value) =>
          onChange({ ...section, identityNamespace: value || undefined })
        }
      />
      <div className="grid gap-2 sm:grid-cols-2">
        {identityFields.map((field) => (
          <IdentityChoice
            key={field}
            label={fieldLabel(field)}
            checked={selectedIdentities.includes(field)}
            disabled={
              !selectedIdentities.includes(field) &&
              selectedIdentities.length >= 8
            }
            onChange={(checked) => {
              const fields = checked
                ? [...selectedIdentities, field]
                : selectedIdentities.filter((value) => value !== field)
              onChange({
                ...section,
                identityFields: fields,
                identityNamespace: fields.length
                  ? section.identityNamespace
                  : undefined,
              })
            }}
          />
        ))}
      </div>
      {!identityFields.length && (
        <p className="text-xs">
          {t("settings.importPreparation.mapIdentityFirst", {
            defaultValue:
              "Map a record reference, name or contact identifier before choosing a stable identity.",
          })}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t("settings.importPreparation.aliasHint", {
          defaultValue:
            "Label aliases preserve the original words and propose a reviewed meaning. Text trimming and case changes run before exact aliases. Amounts, units, payment verification and record states are never rewritten by these rules.",
        })}
      </p>
      {aliases.map((alias, index) => (
        <div
          key={index}
          className="grid gap-2 rounded border p-2 sm:grid-cols-2"
        >
          <Choice
            label={t("settings.importPreparation.aliasField", {
              defaultValue: "Label field",
            })}
            value={alias.field}
            options={textFields.map((field) => ({
              value: field,
              label: fieldLabel(field),
            }))}
            onChange={(field) =>
              onChange({
                ...section,
                aliases: aliases.map((value, position) =>
                  position === index ? { ...value, field } : value,
                ),
              })
            }
          />
          <TextField
            label={t("settings.importPreparation.aliasFrom", {
              defaultValue: "Exact source words",
            })}
            value={alias.from}
            maxLength={2000}
            onChange={(from) =>
              onChange({
                ...section,
                aliases: aliases.map((value, position) =>
                  position === index ? { ...value, from } : value,
                ),
              })
            }
          />
          <TextField
            label={t("settings.importPreparation.aliasTo", {
              defaultValue: "Proposed meaning",
            })}
            value={alias.to}
            maxLength={2000}
            onChange={(to) =>
              onChange({
                ...section,
                aliases: aliases.map((value, position) =>
                  position === index ? { ...value, to } : value,
                ),
              })
            }
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onChange({
                ...section,
                aliases: aliases.filter((_, position) => position !== index),
              })
            }
          >
            {t("settings.importPreparation.removeAlias", {
              defaultValue: "Remove label alias",
            })}
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={!textFields.length || aliases.length >= 100}
        onClick={() =>
          onChange({
            ...section,
            aliases: [...aliases, { field: textFields[0]!, from: "", to: "" }],
          })
        }
      >
        {t("settings.importPreparation.addAlias", {
          defaultValue: "Add a label alias",
        })}
      </Button>
      {transforms.map((transform, index) => (
        <div
          key={index}
          className="grid gap-2 rounded border p-2 sm:grid-cols-3"
        >
          <Choice
            label={t("settings.importPreparation.transformField", {
              defaultValue: "Text field",
            })}
            value={transform.field}
            options={textFields.map((field) => ({
              value: field,
              label: fieldLabel(field),
            }))}
            onChange={(field) =>
              onChange({
                ...section,
                transforms: transforms.map((value, position) =>
                  position === index ? { ...value, field } : value,
                ),
              })
            }
          />
          <Choice
            label={t("settings.importPreparation.transform", {
              defaultValue: "Text adjustment",
            })}
            value={transform.operation}
            onChange={(operation) =>
              onChange({
                ...section,
                transforms: transforms.map((value, position) =>
                  position === index
                    ? {
                        ...value,
                        operation: operation as
                          | "trim"
                          | "uppercase"
                          | "lowercase",
                      }
                    : value,
                ),
              })
            }
            options={[
              {
                value: "trim",
                label: t("settings.importPreparation.trim", {
                  defaultValue: "Remove surrounding spaces",
                }),
              },
              {
                value: "uppercase",
                label: t("settings.importPreparation.uppercase", {
                  defaultValue: "Use uppercase letters",
                }),
              },
              {
                value: "lowercase",
                label: t("settings.importPreparation.lowercase", {
                  defaultValue: "Use lowercase letters",
                }),
              },
            ]}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onChange({
                ...section,
                transforms: transforms.filter(
                  (_, position) => position !== index,
                ),
              })
            }
          >
            {t("settings.importPreparation.removeTransform", {
              defaultValue: "Remove text adjustment",
            })}
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={!textFields.length || transforms.length >= 100}
        onClick={() =>
          onChange({
            ...section,
            transforms: [
              ...transforms,
              { field: textFields[0]!, operation: "trim" },
            ],
          })
        }
      >
        {t("settings.importPreparation.addTransform", {
          defaultValue: "Add a text adjustment",
        })}
      </Button>
    </details>
  )
}

function IdentityChoice({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <Field orientation="horizontal">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
    </Field>
  )
}

function SourceCoverage({
  coverage,
}: {
  coverage: ImportCoverage["files"][number]
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState(0)
  const records = coverage.records.slice(page * 50, (page + 1) * 50)
  return (
    <details className="space-y-2 text-sm">
      <summary className="cursor-pointer">
        {t("settings.importPreparation.coverageTitle", {
          defaultValue: "Source record coverage",
        })}
      </summary>
      <p>
        {coverage.worksheet ? `${coverage.worksheet} · ` : ""}
        {t("settings.importPreparation.coverageCounts", {
          defaultValue:
            "{{review}} review records · {{headers}} headers · {{blank}} blank records",
          review: coverage.reviewRecords,
          headers: coverage.headerRecords,
          blank: coverage.blankRecords,
        })}
      </p>
      {coverage.error ? (
        <p role="alert">{coverage.error}</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("settings.importPreparation.logicalRecord", {
                    defaultValue: "Record",
                  })}
                </TableHead>
                <TableHead>
                  {t("settings.importPreparation.originalRows", {
                    defaultValue: "Original rows",
                  })}
                </TableHead>
                <TableHead>
                  {t("settings.importPreparation.coverageDisposition", {
                    defaultValue: "Treatment",
                  })}
                </TableHead>
                <TableHead>
                  {t("settings.importPreparation.sourceSections", {
                    defaultValue: "Sections",
                  })}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.record}>
                  <TableCell>{record.record}</TableCell>
                  <TableCell>
                    {record.rowStart === record.rowEnd
                      ? record.rowStart
                      : `${record.rowStart}–${record.rowEnd}`}
                  </TableCell>
                  <TableCell>
                    {record.disposition === "review"
                      ? t("settings.importPreparation.reviewRecord", {
                          defaultValue: "Source review",
                        })
                      : record.disposition === "header"
                        ? t("settings.importPreparation.header", {
                            defaultValue: "Header",
                          })
                        : t("settings.importPreparation.blank", {
                            defaultValue: "Blank",
                          })}
                  </TableCell>
                  <TableCell>{record.sectionKeys.join(", ") || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <CoveragePages
            page={page}
            total={coverage.records.length}
            onPage={setPage}
          />
        </>
      )}
    </details>
  )
}

function ReconciliationCoverage({
  groups,
}: {
  groups: ImportCoverage["reconciliation"]
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState(0)
  const statusLabel = (
    status: ImportCoverage["reconciliation"][number]["status"],
  ) =>
    ({
      same_record: t("settings.importPreparation.sameRecord", {
        defaultValue: "Matching business records",
      }),
      conflicting_version: t("settings.importPreparation.conflictingVersion", {
        defaultValue: "Conflicting source versions",
      }),
      missing_identity: t("settings.importPreparation.missingIdentity", {
        defaultValue: "Missing stable record identity",
      }),
      overlapping_period: t("settings.importPreparation.overlappingPeriod", {
        defaultValue: "Overlapping reporting periods",
      }),
    })[status]
  return (
    <details className="space-y-2 text-sm">
      <summary className="cursor-pointer font-medium">
        {t("settings.importPreparation.reconciliationGroups", {
          defaultValue:
            "{{count}} source overlap or identity groups need review",
          count: groups.length,
        })}
      </summary>
      <p>
        {t("settings.importPreparation.reconciliationBoundary", {
          defaultValue:
            "These comparisons hold source rows for review. They do not establish a payment, overwrite existing records, or combine report totals.",
        })}
      </p>
      <ul className="space-y-2">
        {groups.slice(page * 50, (page + 1) * 50).map((group, index) => (
          <li key={page * 50 + index} className="rounded border p-2">
            <p className="font-medium">{statusLabel(group.status)}</p>
            <p>
              {group.sources
                .slice(0, 10)
                .map(
                  (source) =>
                    `${source.fileName}: ${source.rowStart === source.rowEnd ? source.rowStart : `${source.rowStart}–${source.rowEnd}`}`,
                )
                .join(" · ")}
            </p>
            {group.sources.length > 10 && (
              <p>
                {t("settings.importPreparation.otherRecords", {
                  defaultValue:
                    "Plus {{count}} other source records in this group.",
                  count: group.sources.length - 10,
                })}
              </p>
            )}
          </li>
        ))}
      </ul>
      <CoveragePages page={page} total={groups.length} onPage={setPage} />
    </details>
  )
}

function CoveragePages({
  page,
  total,
  onPage,
}: {
  page: number
  total: number
  onPage: (page: number) => void
}) {
  const { t } = useTranslation()
  if (total <= 50) return null
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        {t("settings.importPreparation.previous", { defaultValue: "Previous" })}
      </Button>
      <span>
        {t("settings.importPreparation.page", {
          defaultValue: "Page {{page}} of {{pages}}",
          page: page + 1,
          pages: Math.ceil(total / 50),
        })}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={(page + 1) * 50 >= total}
        onClick={() => onPage(page + 1)}
      >
        {t("settings.importPreparation.next", { defaultValue: "Next" })}
      </Button>
    </div>
  )
}
