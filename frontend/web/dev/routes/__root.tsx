import { createRootRoute, Link, Outlet, useRouterState } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { cn } from '@/lib/utils'
import {
  FlaskConical,
  Database,
  Search,
  ScrollText,
  Code2,
  BarChart3,
  ChevronRight,
} from 'lucide-react'

const TanStackRouterDevtools =
  process.env.NODE_ENV === 'production'
    ? () => null
    : lazy(() =>
        import('@tanstack/router-devtools').then((res) => ({
          default: res.TanStackRouterDevtools,
        }))
      )

const NAV_ITEMS = [
  { to: '/dev/reducer-lab', label: 'Reducer Lab', icon: FlaskConical },
  { to: '/dev/db-explorer', label: 'DB Explorer', icon: Database },
  { to: '/dev/query-runner', label: 'Query Runner', icon: Search },
  { to: '/dev/log-viewer', label: 'Log Viewer', icon: ScrollText },
  { to: '/dev/schema-viewer', label: 'Schema Viewer', icon: Code2 },
  { to: '/dev/coverage', label: 'Coverage', icon: BarChart3 },
] as const

export const Route = createRootRoute({
  component: DevShell,
})

function DevShell() {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-52 shrink-0 border-r bg-muted/30 flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Dev Tools
            </span>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
            const isActive = currentPath === to || currentPath.startsWith(to + '?')
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
                {isActive && <ChevronRight className="w-3 h-3 ml-auto" />}
              </Link>
            )
          })}
        </nav>
        <div className="p-3 border-t">
          <p className="text-[10px] text-muted-foreground">
            localhost only · not in prod
          </p>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>

      <Suspense>
        <TanStackRouterDevtools position="bottom-right" />
      </Suspense>
    </div>
  )
}
