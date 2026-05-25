import { createRoute, redirect } from '@tanstack/react-router'
import { Route as rootRoute } from './__root'

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev',
  beforeLoad: () => {
    throw redirect({ to: '/dev/reducer-lab', search: { reducer: '' } })
  },
})
