/**
 * Shared form-request preparation for the AI form suggest/validate routes.
 */
import type { JsonObject } from './route-helpers'

export const MAX_FIELDS = 80
export const MAX_RAW_TEXT_LENGTH = 20_000

export const SUPPORTED_FIELD_TYPES = new Set([
  'text',
  'email',
  'number',
  'tel',
  'url',
  'textarea',
  'select',
  'checkbox',
  'switch',
  'radio',
  'date',
  'time',
  'datetime',
  'hidden',
])

function nonEmptyString(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * Sanitize an array of form-field definitions for the AI gateway.
 * Deduplicates by name, caps at MAX_FIELDS, validates field types,
 * and sanitizes options and validation constraints.
 */
export function sanitizeFields(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return []

  const out: Array<Record<string, unknown>> = []
  const seen = new Set<string>()

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = nonEmptyString(record.name)
    const type = nonEmptyString(record.type)
    if (!name || !SUPPORTED_FIELD_TYPES.has(type) || seen.has(name)) continue
    seen.add(name)

    const field: Record<string, unknown> = {
      name,
      type,
      required: record.required === true,
    }

    const label = nonEmptyString(record.label)
    if (label) field.label = label.slice(0, 160)

    if (Array.isArray(record.options)) {
      field.options = record.options
        .filter((option): option is Record<string, unknown> => !!option && typeof option === 'object')
        .slice(0, 200)
        .map((option) => ({
          value: nonEmptyString(option.value),
          label: nonEmptyString(option.label),
          ...(option.disabled === true ? { disabled: true } : {}),
        }))
        .filter((option) => option.value)
    }

    if (record.validation && typeof record.validation === 'object') {
      const validation = record.validation as Record<string, unknown>
      field.validation = {
        ...(typeof validation.min === 'number' ? { min: validation.min } : {}),
        ...(typeof validation.max === 'number' ? { max: validation.max } : {}),
        ...(typeof validation.minLength === 'number' ? { minLength: validation.minLength } : {}),
        ...(typeof validation.maxLength === 'number' ? { maxLength: validation.maxLength } : {}),
        ...(typeof validation.pattern === 'string' ? { pattern: validation.pattern.slice(0, 500) } : {}),
      }
    }

    out.push(field)
    if (out.length >= MAX_FIELDS) break
  }

  return out
}

/**
 * Resolve a snake/camel alias pair to a trimmed string (empty for non-strings).
 */
export function aliasString(body: JsonObject, camel: string, snake: string): string {
  return nonEmptyString(body[camel] ?? body[snake])
}
