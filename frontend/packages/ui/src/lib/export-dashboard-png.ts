import { toPng } from "html-to-image"

function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a")
  link.download = filename
  link.href = dataUrl
  link.click()
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "dashboard"
}

/**
 * Export a dashboard grid (or any HTMLElement) as a PNG download.
 */
export async function exportDashboardToPng(
  element: HTMLElement,
  filename = "dashboard",
): Promise<void> {
  const dataUrl = await toPng(element, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--background")
      ? `hsl(${getComputedStyle(document.documentElement).getPropertyValue("--background")})`
      : undefined,
  })
  downloadDataUrl(dataUrl, `${sanitizeFilename(filename)}.png`)
}

/**
 * Export a single chart card/container as PNG.
 */
export async function exportChartToPng(
  element: HTMLElement,
  chartTitle: string,
): Promise<void> {
  const dataUrl = await toPng(element, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--card")
      ? `hsl(${getComputedStyle(document.documentElement).getPropertyValue("--card")})`
      : "#ffffff",
  })
  downloadDataUrl(dataUrl, `${sanitizeFilename(chartTitle)}.png`)
}
