'use client'

import { RouterProvider } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { devRouter } from '@/dev/router'

export default function DevEntryPage() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return <RouterProvider router={devRouter} />
}

