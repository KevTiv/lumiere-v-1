import { fireEvent } from "@testing-library/react"

/** jsdom lacks the pointer-capture and scroll APIs Radix Select calls while opening. */
export function installSelectDomShims() {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
}

/** Open a shared Select from its trigger and pick the item whose value matches. */
export function chooseSelectValue(trigger: HTMLElement, value: string) {
  installSelectDomShims()
  fireEvent.keyDown(trigger, { key: "Enter" })
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (item) => item.dataset.value === value,
  )
  if (!option) throw new Error(`No select option with value "${value}"`)
  fireEvent.click(option)
}
