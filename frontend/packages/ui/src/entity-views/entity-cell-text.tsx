"use client"

import { cloneElement, isValidElement, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Maximize2 } from "lucide-react"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../components/popover"

const listeners = new WeakMap<Element, () => void>()
let resizeObserver: ResizeObserver | undefined

function observePreview(element: HTMLElement, update: () => void) {
  if (typeof ResizeObserver === "undefined") return
  resizeObserver ??= new ResizeObserver((entries) => {
    for (const { target } of entries) listeners.get(target)?.()
  })
  listeners.set(element, update)
  resizeObserver.observe(element)
  return () => {
    listeners.delete(element)
    resizeObserver?.unobserve(element)
  }
}

type TextLink = ReactElement<{ href: string | object; children: ReactNode }>

export function asEntityCellTextLink(content: ReactNode): TextLink | undefined {
  if (!isValidElement<TextLink["props"]>(content)) return
  const { children, href } = content.props
  if (typeof children === "string" && (typeof href === "string" || (href && typeof href === "object"))) {
    return content
  }
}

export function EntityCellText({ label, text, lines, editable, link }: {
  label: string
  text: string
  lines: 1 | 2 | 3
  editable?: boolean
  link?: TextLink
}) {
  const { t } = useTranslation()
  const previewRef = useRef<HTMLSpanElement>(null)
  const [clipped, setClipped] = useState(false)
  const separateTrigger = editable || Boolean(link)

  useLayoutEffect(() => {
    const preview = previewRef.current
    if (!preview) return
    const update = () =>
      setClipped(preview.scrollHeight > preview.clientHeight + 1 || preview.scrollWidth > preview.clientWidth + 1)
    update()
    return observePreview(preview, update)
  }, [clipped, lines, separateTrigger, text])

  const preview = (
    <span
      ref={previewRef}
      className="overflow-hidden whitespace-pre-line [overflow-wrap:anywhere]"
      style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines }}
    >
      {text}
    </span>
  )
  const disclose = t("common.entityView.showFullValue", { defaultValue: "Show full value" })
  const disclosure = clipped ? (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={separateTrigger ? `${disclose}: ${label}` : undefined}
        aria-description={separateTrigger ? undefined : disclose}
        className={separateTrigger
          ? "absolute right-0 top-0 grid size-6 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          : "block w-full cursor-pointer rounded-sm text-inherit [text-align:inherit] underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {separateTrigger ? <Maximize2 className="size-3.5" aria-hidden="true" /> : preview}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[min(20rem,60dvh)] w-88 max-w-[calc(100vw-2rem)] overflow-auto p-3"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <PopoverTitle>{label}</PopoverTitle>
        <p className="select-text whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</p>
      </PopoverContent>
    </Popover>
  ) : null
  return separateTrigger
    ? <span className={clipped ? "relative block pr-7" : "relative block"}>{link ? cloneElement(link, undefined, preview) : preview}{disclosure}</span>
    : disclosure ?? preview
}
