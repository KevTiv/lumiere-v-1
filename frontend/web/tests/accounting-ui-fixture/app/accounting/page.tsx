import AccountingFixture from "../page"
import ListRefinementFixture from "../list-refinement/page"

export default async function AccountingRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams
  return query.journey === "return" ? <ListRefinementFixture /> : <AccountingFixture />
}
