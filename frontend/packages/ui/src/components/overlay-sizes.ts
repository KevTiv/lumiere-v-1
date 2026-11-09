import type { CSSProperties } from "react"
import { cn } from "@lumiere/ui/lib/utils"

// Widths express the task's needs; each surface applies its own viewport cap.
export const overlayWidths = {
  confirmation: "28rem",
  form: "40rem",
  record: "56rem",
  review: "72rem",
  document: "100vw",
} as const

export type OverlaySize = keyof typeof overlayWidths

export function mergeOverlayClassName<State>(
  base: string,
  className: string | ((state: State) => string | undefined) | undefined,
) {
  return typeof className === "function"
    ? (state: State) => cn(base, className(state))
    : cn(base, className)
}

export function constrainOverlayStyle<State>(
  style:
    | CSSProperties
    | ((state: State) => CSSProperties | undefined)
    | undefined,
  constraints: CSSProperties
) {
  return typeof style === "function"
    ? (state: State) => ({ ...style(state), ...constraints })
    : { ...style, ...constraints }
}
