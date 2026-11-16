import { stbTimestampMicros } from "@lumiere/erp-shared/stb-timestamp"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import type { QueryRowFor } from "@lumiere/stdb/query-row-map"

type ForecastRow = QueryRowFor<"crm-forecast-snapshots">

export function latestCompanyForecast(rows: readonly ForecastRow[], companyId: bigint): ForecastRow | undefined {
  let latest: ForecastRow | undefined
  let latestTime: bigint | null = null
  let latestId = 0n
  for (const row of rows) {
    if (parseStrictU64(row.companyId) !== companyId) continue
    const time = stbTimestampMicros(row.createdAt)
    const id = parseStrictU64(row.id)
    if (time === null || id === undefined) continue
    if (latestTime == null || time > latestTime || (time === latestTime && id > latestId)) {
      latest = row
      latestTime = time
      latestId = id
    }
  }
  return latest
}
