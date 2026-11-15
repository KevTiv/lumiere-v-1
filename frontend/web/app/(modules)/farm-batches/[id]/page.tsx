import { notFound } from "next/navigation"
import { getStdbSession } from "@/lib/api-session"
import { FarmBatchesWorkspace } from "../farm-batches-workspace"
import { farmRecordId } from "../farm-batch-model"

type Props = { params: Promise<{ id: string }> }

export default async function FarmBatchPage({ params }: Props) {
  const { id } = await params
  if (!farmRecordId(id)) notFound()
  const session = await getStdbSession()
  return <FarmBatchesWorkspace organizationId={session?.organizationId} batchId={id} />
}
