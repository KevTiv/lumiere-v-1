import { redirect } from "next/navigation"
import { cookies } from "next/headers"

export default async function RootPage() {
  const store = await cookies()
  const hasSession = Boolean(store.get("stdb_token")?.value)
  redirect(hasSession ? "/overview" : "/sign-in")
}
