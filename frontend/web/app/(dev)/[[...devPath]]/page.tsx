'use client'

import { RouterProvider } from '@tanstack/react-router'
import { devRouter } from '@/dev/router'

export default function DevEntryPage() {
  return <RouterProvider router={devRouter} />
}
