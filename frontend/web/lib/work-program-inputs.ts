/** Internal input editor for the admitted scalar JSON Schema subset.
 * This is a view model, not a public WorkProgram wire contract or authority grant.
 * Unknown schema constraints fail closed until the producer contract is released.
 */
export type ProgramInputValue = string | number | boolean
export interface ProgramInputField {
  key: string
  label: string
  type: "string" | "number" | "integer" | "boolean"
  required: boolean
  enum?: ProgramInputValue[]
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  format?: "date"
}
export interface ProgramInputSchema { fields: ProgramInputField[] }

const RESERVED = /^(?:organization_?id|org_?id|company_?id|actor.*|identity.*|.*token|.*secret|.*credential|permissions?|capabilities|policy.*|__proto__|prototype|constructor)$/i
const FIELD_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function exact(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).every((key) => keys.includes(key)) }
function bound(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 }

export function parseProgramInputSchema(value: unknown): ProgramInputSchema | null {
  const root = record(value)
  if (!root || !exact(root, ["type", "properties", "required", "additionalProperties"]) || root.type !== "object" || root.additionalProperties !== false) return null
  const properties = record(root.properties)
  if (!properties || Object.keys(properties).length > 16) return null
  const required = root.required ?? []
  if (!Array.isArray(required) || required.some((key) => typeof key !== "string" || !Object.hasOwn(properties, key)) || new Set(required).size !== required.length) return null
  const fields: ProgramInputField[] = []
  for (const [key, raw] of Object.entries(properties)) {
    const item = record(raw)
    if (!FIELD_KEY.test(key) || RESERVED.test(key) || !item || !exact(item, ["type", "title", "enum", "minLength", "maxLength", "minimum", "maximum", "format"])) return null
    if (!["string", "integer", "number", "boolean"].includes(String(item.type))) return null
    if (item.title !== undefined && (typeof item.title !== "string" || item.title.length > 120 || !item.title.trim())) return null
    const field: ProgramInputField = { key, label: typeof item.title === "string" ? item.title : key, type: item.type as ProgramInputField["type"], required: required.includes(key) }
    if (item.type === "string") {
      if (item.minimum !== undefined || item.maximum !== undefined) return null
      if (item.format !== undefined && item.format !== "date") return null
      if (item.format === "date") field.format = "date"
      for (const name of ["minLength", "maxLength"] as const) {
        if (item[name] !== undefined) {
          if (!bound(item[name]) || item[name] > 2000) return null
          field[name] = item[name]
        }
      }
      if ((field.minLength ?? 0) > (field.maxLength ?? 2000)) return null
    } else {
      if (item.minLength !== undefined || item.maxLength !== undefined || item.format !== undefined) return null
      for (const name of ["minimum", "maximum"] as const) {
        if (item[name] !== undefined) {
          if (item.type === "boolean" || typeof item[name] !== "number" || !Number.isFinite(item[name])) return null
          field[name] = item[name]
        }
      }
      if ((field.minimum ?? -Infinity) > (field.maximum ?? Infinity)) return null
    }
    if (item.enum !== undefined) {
      if (!Array.isArray(item.enum) || !item.enum.length || item.enum.length > 32 || new Set(item.enum).size !== item.enum.length || item.enum.some((option) => !validValue(field, option))) return null
      field.enum = item.enum as ProgramInputValue[]
    }
    fields.push(field)
  }
  return { fields }
}

function validValue(field: ProgramInputField, value: unknown): value is ProgramInputValue {
  if (field.type === "boolean") return typeof value === "boolean"
  if (field.type === "string") {
    if (typeof value !== "string" || [...value].length < (field.minLength ?? 0) || [...value].length > (field.maxLength ?? 2000)) return false
    if (field.format === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return false
    return true
  }
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER && (field.type !== "integer" || Number.isSafeInteger(value)) && value >= (field.minimum ?? -Infinity) && value <= (field.maximum ?? Infinity)
}

export function validateProgramInputs(schema: ProgramInputSchema, value: unknown): { valid: true; values: Record<string, ProgramInputValue> } | { valid: false; errors: string[] } {
  const inputs = record(value)
  if (!inputs) return { valid: false, errors: ["Inputs must be an object."] }
  const errors: string[] = []
  const result: Record<string, ProgramInputValue> = {}
  for (const key of Object.keys(inputs)) if (!schema.fields.some((field) => field.key === key)) errors.push(`Unsupported input: ${key}`)
  for (const field of schema.fields) {
    if (!Object.hasOwn(inputs, field.key)) {
      if (field.required) errors.push(`${field.label} is required.`)
      continue
    }
    const item = inputs[field.key]
    if (!validValue(field, item) || (field.enum !== undefined && !field.enum.includes(item))) errors.push(`${field.label} is invalid.`)
    else result[field.key] = item
  }
  return errors.length ? { valid: false, errors } : { valid: true, values: result }
}

/** HTML form text is converted only for a declared field, without coercing blank to zero. */
export function programInputFromControl(field: ProgramInputField, raw: string): ProgramInputValue | undefined {
  if (raw === "" && field.type !== "string") return undefined
  if (field.type === "boolean") return raw === "true" ? true : raw === "false" ? false : undefined
  // Keep malformed text visible and invalid. Only a real blank omits an optional value.
  if (field.type === "number" || field.type === "integer") return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw) ? Number(raw) : raw
  return raw
}
