import { createRouter } from '@tanstack/react-router'
import { Route as rootRoute } from './routes/__root'
import { Route as indexRoute } from './routes/index'
import { Route as reducerLabRoute } from './routes/reducer-lab'
import { Route as dbExplorerRoute } from './routes/db-explorer'
import { Route as queryRunnerRoute } from './routes/query-runner'
import { Route as logViewerRoute } from './routes/log-viewer'
import { Route as schemaViewerRoute } from './routes/schema-viewer'
import { Route as coverageRoute } from './routes/coverage'

const routeTree = rootRoute.addChildren([
  indexRoute,
  reducerLabRoute,
  dbExplorerRoute,
  queryRunnerRoute,
  logViewerRoute,
  schemaViewerRoute,
  coverageRoute,
])

export const devRouter = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadDelay: 50,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof devRouter
  }
}
