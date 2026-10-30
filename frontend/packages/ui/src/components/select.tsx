"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp, Search } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"

import { cn } from "@/lib/utils"

const SEARCH_THRESHOLD = 14
const SelectSearchContext = React.createContext(false)

type SelectChildProps = {
  children?: React.ReactNode
  textValue?: string
  disabled?: boolean
  "data-search-hidden"?: boolean
  style?: React.CSSProperties
}

function optionText(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((child): string => {
      if (typeof child === "string" || typeof child === "number") return String(child)
      return React.isValidElement<SelectChildProps>(child) ? optionText(child.props.children) : ""
    })
    .join("")
}

function optionCount(children: React.ReactNode, search = ""): number {
  return React.Children.toArray(children).reduce<number>((count, child) => {
    if (!React.isValidElement<SelectChildProps>(child)) return count
    if (child.type === SelectItem) {
      const text = child.props.textValue ?? optionText(child.props.children)
      return count + Number(text.toLocaleLowerCase().includes(search))
    }
    return count + optionCount(child.props.children, search)
  }, 0)
}

// Keep items mounted so filtering does not erase the selected label or native form value.
function filterOptions(children: React.ReactNode, search: string): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (!React.isValidElement<SelectChildProps>(child)) return child
    if (child.type === SelectItem) {
      const matches = (child.props.textValue ?? optionText(child.props.children))
        .toLocaleLowerCase()
        .includes(search)
      return React.cloneElement(child, {
        "data-search-hidden": !matches || undefined,
        style: matches ? child.props.style : { ...child.props.style, display: "none" },
      })
    }
    if (child.props.children == null) return child
    if (child.type === SelectGroup && optionCount(child.props.children, search) === 0) {
      return React.cloneElement(child, {
        style: { ...child.props.style, display: "none" },
        children: filterOptions(child.props.children, search),
      })
    }
    return React.cloneElement(child, { children: filterOptions(child.props.children, search) })
  })
}

function Select({ children, ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return (
    <SelectSearchContext.Provider value={optionCount(children) > SEARCH_THRESHOLD}>
      <SelectPrimitive.Root {...props}>{children}</SelectPrimitive.Root>
    </SelectSearchContext.Provider>
  )
}
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => {
  const searchable = React.useContext(SelectSearchContext)
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      aria-haspopup={searchable ? "dialog" : "listbox"}
      ref={ref}
      className={cn(
        "flex h-9 w-full min-w-0 pointer-coarse:min-h-11 items-center justify-between rounded-lg border border-input bg-background px-3 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
})
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName

function SelectSearchInput({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (value: string) => void
  label: string
}) {
  const ref = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    onChange("")
    // Radix first positions the popup and focuses its selected item.
    const frame = requestAnimationFrame(() => ref.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [onChange])
  return (
    <div className="flex items-center gap-2 border-b px-3">
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") return
          // Text entry must not trigger Radix typeahead or close the popup on Space.
          event.stopPropagation()
          if (["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key)) {
            event.preventDefault()
            const options = event.currentTarget
              .closest('[role="dialog"]')
              ?.querySelectorAll<HTMLElement>(
                '[role="option"]:not([data-disabled]):not([data-search-hidden])',
              )
            const option =
              event.key === "ArrowUp" || event.shiftKey
                ? options?.[options.length - 1]
                : options?.[0]
            if (event.key === "Enter") option?.click()
            else option?.focus()
          }
        }}
        className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
      />
    </div>
  )
}

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(
  (
    {
      className,
      children,
      position = "popper",
      onCloseAutoFocus,
      onKeyDown,
      onEscapeKeyDown,
      ...props
    },
    ref,
  ) => {
    const searchable = React.useContext(SelectSearchContext)
    const [search, setSearch] = React.useState("")
    const { t } = useTranslation()
    const query = searchable ? search.trim().toLocaleLowerCase() : ""
    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          ref={ref}
          role={searchable ? "dialog" : "listbox"}
          aria-modal={searchable || undefined}
          aria-label={
            searchable ? t("common.select.options", { defaultValue: "Options" }) : undefined
          }
          className={cn(
            "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=closed]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            position === "popper" &&
              "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
            className,
          )}
          position={position}
          onKeyDown={(event) => {
            onKeyDown?.(event)
            if (event.defaultPrevented || !searchable || event.target instanceof HTMLInputElement)
              return
            const options = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                '[role="option"]:not([data-disabled]):not([data-search-hidden])',
              ),
            )
            if (event.key === "Tab") {
              event.preventDefault()
              event.currentTarget.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
            } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault()
              const index = options.indexOf(document.activeElement as HTMLElement)
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? options.length - 1
                    : index + (event.key === "ArrowUp" ? -1 : 1)
              options[Math.max(0, Math.min(options.length - 1, next))]?.focus()
            } else if (
              event.key.length === 1 &&
              event.key !== " " &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              event.preventDefault()
              setSearch((previous) => previous + event.key)
              event.currentTarget.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
            }
          }}
          onEscapeKeyDown={(event) => {
            onEscapeKeyDown?.(event)
            // A Radix popup inside a Base UI dialog must consume its own Escape.
            event.stopPropagation()
          }}
          onCloseAutoFocus={(event) => {
            setSearch("")
            onCloseAutoFocus?.(event)
          }}
          {...props}
        >
          {searchable && (
            <SelectSearchInput
              value={search}
              onChange={setSearch}
              label={t("common.select.search", { defaultValue: "Search options…" })}
            />
          )}
          {!searchable && <SelectScrollUpButton />}
          <SelectPrimitive.Viewport
            role={searchable ? "listbox" : undefined}
            aria-label={
              searchable ? t("common.select.options", { defaultValue: "Options" }) : undefined
            }
            className={cn(
              "p-1",
              position === "popper" && "w-full min-w-(--radix-select-trigger-width)",
              searchable ? "max-h-72" : position === "popper" && "h-(--radix-select-trigger-height)",
            )}
          >
            {query ? filterOptions(children, query) : children}
          </SelectPrimitive.Viewport>
          {searchable && query && optionCount(children, query) === 0 && (
            <p role="status" className="px-3 py-4 text-sm text-muted-foreground">
              {t("common.select.noMatches", { defaultValue: "No matching options" })}
            </p>
          )}
          {!searchable && <SelectScrollDownButton />}
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    )
  },
)
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full pointer-coarse:min-h-11 cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
      className,
    )}
    data-value={props.value}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
