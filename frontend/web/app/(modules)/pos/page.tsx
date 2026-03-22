"use client"

import { POSPage } from '@lumiere/ui/pos/pos-page'
import { usePOS } from './use-pos'

export default function POSPageWrapper() {
  const pos = usePOS()
  return <POSPage {...pos} />
}
