import { Skeleton } from "@lumiere/ui/components/skeleton"

export default function ModulesLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-5 sm:px-6 animate-in fade-in-0 duration-150"
      aria-busy="true"
      aria-label="Loading workspace"
    >
      {/* Page header skeleton */}
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3.5 w-80 max-w-[60vw]" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
      </div>

      {/* Tab strip skeleton */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>

      {/* KPI strip skeleton */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-border/60 bg-card p-4 space-y-2.5"
          >
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>

      {/* Main table / workspace card skeleton */}
      <div className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-8 w-64 rounded-md" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        </div>
        <div className="space-y-2 pt-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      </div>
    </div>
  )
}
