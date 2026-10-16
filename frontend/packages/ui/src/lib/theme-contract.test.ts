// @vitest-environment node
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const base = readFileSync(new URL("../styles/tokens-base.css", import.meta.url), "utf8")
const extended = readFileSync(new URL("../styles/theme-extended.css", import.meta.url), "utf8")
const ocean = readFileSync(new URL("../styles/palettes/ocean.css", import.meta.url), "utf8")

function declarations(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`Missing theme selector: ${selector}`)
  const block = css.slice(start, css.indexOf("}", start))
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]))
}

function rgb(channels: string): number[] {
  const match = channels.match(/^([\d.]+) ([\d.]+)% ([\d.]+)%$/)
  if (!match) throw new Error(`Not an HSL colour: ${channels}`)
  const hue = Number(match[1]) / 30
  const saturation = Number(match[2]) / 100
  const lightness = Number(match[3]) / 100
  const amplitude = saturation * Math.min(lightness, 1 - lightness)
  return [0, 8, 4].map((offset) => {
    const k = (offset + hue) % 12
    return lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  })
}

function luminance(colour: number[]) {
  const [r, g, b] = colour.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: number[], b: number[]) {
  const values = [luminance(a), luminance(b)].sort((left, right) => right - left)
  return (values[0]! + 0.05) / (values[1]! + 0.05)
}

describe("shared theme roles", () => {
  for (const mode of ["light", "dark"] as const) {
    for (const palette of ["default", "ocean"] as const) {
      const selector = mode === "dark" ? ".dark" : ":root"
      const tokens = { ...declarations(base, ":root"), ...declarations(extended, ":root"),
        ...(mode === "dark" ? { ...declarations(base, selector), ...declarations(extended, selector) } : {}),
        ...(palette === "ocean" ? declarations(ocean, mode === "dark" ? '.dark[data-palette="ocean"]' : ':root.light[data-palette="ocean"]') : {}),
      }
      const colour = (token: string) => rgb(tokens[token]!)
      it(`${mode}/${palette} keeps text, action, navigation and focus roles legible`, () => {
        for (const [foreground, background] of [
          ["foreground", "background"], ["card-foreground", "card"],
          ["muted-foreground", "muted"], ["muted-foreground", "card"],
          ["primary-foreground", "primary"], ["secondary-foreground", "secondary"],
          ["accent-foreground", "accent"], ["sidebar-foreground", "sidebar"],
          ["sidebar-accent-foreground", "sidebar-accent"], ["sidebar-primary-foreground", "sidebar-primary"],
        ]) expect(contrast(colour(foreground!), colour(background!)), `${foreground}/${background}`).toBeGreaterThanOrEqual(4.5)
        for (const role of ["ring", "input"]) expect(contrast(colour(role), colour("background")), role).toBeGreaterThanOrEqual(3)
        for (const role of ["success", "warning", "info", "destructive"]) {
          expect(contrast(colour(role), colour("card")), `${role} text`).toBeGreaterThanOrEqual(4.5)
          expect(contrast(colour(`${role}-foreground`), colour(role)), `${role} solid`).toBeGreaterThanOrEqual(4.5)
          const alpha = role === "destructive" ? 0.2 : 0.15
          const softBackground = colour(role).map((channel, index) => channel * alpha + colour("card")[index]! * (1 - alpha))
          expect(contrast(colour(role), softBackground), `${role} soft badge`).toBeGreaterThanOrEqual(4.5)
        }
      })
    }
  }

  it("uses the loaded Geist font variables with system fallbacks, not a separate font", () => {
    expect(base).toContain('var(--font-geist-sans, "Geist", ui-sans-serif, system-ui, sans-serif)')
    expect(base).toContain('var(--font-geist-mono, "Geist Mono", ui-monospace, monospace)')
  })
})
