import { toPng } from "html-to-image"
import {
  reportExportProvenanceJson,
  sha256Hex,
  type ReportExportArtifactProvenance,
  type ReportExportSourceProvenance,
} from "./report-export-provenance"

function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a")
  link.download = filename
  link.href = dataUrl
  link.click()
}

function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }))
  downloadDataUrl(url, filename)
  URL.revokeObjectURL(url)
}

async function downloadPngWithProvenance(
  dataUrl: string,
  filename: string,
  provenance?: ReportExportSourceProvenance,
): Promise<ReportExportArtifactProvenance | undefined> {
  downloadDataUrl(dataUrl, filename)
  if (!provenance) return undefined
  const manifest: ReportExportArtifactProvenance = {
    ...provenance,
    exportedAt: new Date().toISOString(),
    artifact: {
      filename,
      mimeType: "image/png",
      sha256: await sha256Hex(await (await fetch(dataUrl)).arrayBuffer()),
    },
  }
  downloadText(reportExportProvenanceJson(manifest), `${filename}.provenance.json`)
  return manifest
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
  provenance?: ReportExportSourceProvenance,
): Promise<ReportExportArtifactProvenance | undefined> {
  const dataUrl = await toPng(element, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--background")
      ? `hsl(${getComputedStyle(document.documentElement).getPropertyValue("--background")})`
      : undefined,
  })
  const artifactName = `${sanitizeFilename(filename)}.png`
  return downloadPngWithProvenance(dataUrl, artifactName, provenance)
}

/**
 * Export a single chart card/container as PNG.
 */
export async function exportChartToPng(
  element: HTMLElement,
  chartTitle: string,
  provenance?: ReportExportSourceProvenance,
): Promise<ReportExportArtifactProvenance | undefined> {
  const dataUrl = await toPng(element, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--card")
      ? `hsl(${getComputedStyle(document.documentElement).getPropertyValue("--card")})`
      : "#ffffff",
  })
  const artifactName = `${sanitizeFilename(chartTitle)}.png`
  return downloadPngWithProvenance(dataUrl, artifactName, provenance)
}
