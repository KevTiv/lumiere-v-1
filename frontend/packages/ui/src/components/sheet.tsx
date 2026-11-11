"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"

import { cn } from "@lumiere/ui/lib/utils"
import { Button } from "@lumiere/ui/components/button"
import { XIcon } from "lucide-react"
import { constrainOverlayStyle, mergeOverlayClassName, overlayWidths, type OverlaySize } from "./overlay-sizes"

const navigationWidth = "18rem"

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  size,
  layout,
  style,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  size?: OverlaySize | "navigation"
  /** Use with SheetHeader, SheetBody and SheetFooter to scroll the body. */
  layout?: "bounded"
}) {
  const popupRef = React.useRef<HTMLDivElement>(null)
  const lateral = side === "left" || side === "right"
  const bounded = layout === "bounded"
  const focusHeading = bounded || size === "record" || size === "review" || size === "document"
  const width = size === "navigation" ? navigationWidth : overlayWidths[size ?? "record"]
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        ref={popupRef}
        initialFocus={focusHeading ? () => (
          popupRef.current?.querySelector<HTMLElement>('[data-slot="sheet-title"]') ?? popupRef.current ?? true
        ) : undefined}
        data-slot="sheet-content"
        data-size={size}
        data-layout={layout}
        data-reserve-close={(size || layout) && showCloseButton ? "" : undefined}
        data-side={side}
        className={mergeOverlayClassName(
          cn(
            "fixed z-50 flex flex-col gap-4 bg-background bg-clip-padding text-sm shadow-lg transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-[2.5rem] data-[side=bottom]:data-starting-style:translate-y-[2.5rem] data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:border-r data-[side=left]:data-ending-style:translate-x-[-2.5rem] data-[side=left]:data-starting-style:translate-x-[-2.5rem] data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-[2.5rem] data-[side=right]:data-starting-style:translate-x-[2.5rem] data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:translate-y-[-2.5rem] data-[side=top]:data-starting-style:translate-y-[-2.5rem]",
            size || bounded
              ? "group/sheet min-h-0 min-w-0 overflow-y-auto overscroll-contain [overflow-wrap:anywhere]"
              : "data-[side=left]:w-3/4 data-[side=right]:w-3/4 data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
            bounded && "gap-0",
          ),
          className
        )}
        style={size || layout ? constrainOverlayStyle(style, {
          ...(lateral ? { width, maxWidth: "100%" } : {}),
          maxHeight: lateral ? "100dvh" : "calc(100dvh - 1rem)",
        }) : style}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="absolute end-3 top-3 z-20"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex min-w-0 flex-col gap-0.5 p-4 group-data-[layout=bounded]/sheet:shrink-0 group-data-[reserve-close]/sheet:pe-14", className)}
      {...props}
    />
  )
}

function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn(
        // Keep header and actions in view. Very short screens scroll the popup.
        "min-h-[min(2lh,15dvh)] min-w-0 flex-auto overflow-y-auto overscroll-contain px-4 pb-4 [@media(max-height:24rem)]:min-h-0 [@media(max-height:24rem)]:flex-none [@media(max-height:24rem)]:overflow-visible",
        className,
      )}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "mt-auto flex flex-col gap-2 p-4",
        "group-data-[layout=bounded]/sheet:min-w-0 group-data-[layout=bounded]/sheet:shrink-0",
        "group-data-[layout=bounded]/sheet:[&_:is(button,[data-slot=button])]:h-auto group-data-[layout=bounded]/sheet:[&_:is(button,[data-slot=button])]:min-h-9",
        "group-data-[layout=bounded]/sheet:[&_:is(button,[data-slot=button])]:max-w-full group-data-[layout=bounded]/sheet:[&_:is(button,[data-slot=button])]:whitespace-normal",
        "pointer-coarse:group-data-[layout=bounded]/sheet:[&_:is(button,[data-slot=button])]:min-h-11",
        className,
      )}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      tabIndex={-1}
      className={cn("text-base font-medium text-foreground", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetBody,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
