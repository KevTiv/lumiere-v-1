import AccountingFixture from "../../../page"
import { returnJourneyRows } from "../../../../return-navigation-fixtures"
import ReturnRecordFixture from "./record"

export default async function InvoiceFixtureRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return returnJourneyRows.some((row) => String(row.id) === id) ? <ReturnRecordFixture recordId={id} /> : <AccountingFixture />
}
