import { Skeleton } from './skeleton'
import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
}

/**
 * Skeleton for stat cards (e.g., Net P&L, Total Volume)
 */
export function StatCardSkeleton({ className }: SkeletonProps) {
  return (
    <div className={cn('p-3 space-y-2', className)}>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-3 w-12" />
    </div>
  )
}

/**
 * Grid of stat card skeletons
 */
export function StatsGridSkeleton({
  count = 4,
  className,
}: SkeletonProps & { count?: number }) {
  return (
    <div
      className={cn('grid grid-cols-2 md:grid-cols-4 gap-3', className)}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="bg-card/30 border border-border/30 rounded p-3"
        >
          <StatCardSkeleton />
        </div>
      ))}
    </div>
  )
}

/**
 * Skeleton for table rows
 */
export function TableRowSkeleton({
  columns = 4,
  className,
}: SkeletonProps & { columns?: number }) {
  return (
    <tr className={cn('border-b border-border/20', className)}>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="py-3 px-4">
          <Skeleton className="h-4 w-full max-w-[120px]" />
        </td>
      ))}
    </tr>
  )
}

/**
 * Skeleton for a full table
 */
export function TableSkeleton({
  rows = 5,
  columns = 4,
  className,
}: SkeletonProps & { rows?: number; columns?: number }) {
  return (
    <div className={cn('overflow-hidden', className)}>
      <table className="w-full">
        <thead>
          <tr className="border-b border-border/30 bg-secondary/10">
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} className="py-3 px-4 text-left">
                <Skeleton className="h-3 w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <TableRowSkeleton key={i} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Skeleton for a card with header and content
 */
export function CardSkeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'bg-card/30 border border-border/30 rounded-lg overflow-hidden',
        className
      )}
    >
      <div className="border-b border-border/30 px-4 py-3 bg-secondary/20">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="p-4 space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  )
}

/**
 * Skeleton for leaderboard entries
 */
export function LeaderboardSkeleton({
  rows = 10,
  className,
}: SkeletonProps & { rows?: number }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between p-3 bg-secondary/10 rounded"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  )
}

/**
 * Skeleton for profile sections
 */
export function ProfileSkeleton({ className }: SkeletonProps) {
  return (
    <div className={cn('space-y-6', className)}>
      {/* Avatar and name */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 bg-secondary/20 rounded space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-24" />
        </div>
        <div className="p-4 bg-secondary/20 rounded space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-24" />
        </div>
      </div>

      {/* Form fields */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  )
}

/**
 * Skeleton for history/transaction list
 */
export function HistoryListSkeleton({
  rows = 5,
  className,
}: SkeletonProps & { rows?: number }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between p-3 border border-border/20 rounded"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded" />
            <div className="space-y-1">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <div className="text-right space-y-1">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Full page loading skeleton
 */
export function PageSkeleton({ className }: SkeletonProps) {
  return (
    <div className={cn('min-h-screen bg-background', className)}>
      {/* Header skeleton */}
      <div className="border-b border-border/30 px-4 py-3">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      </div>

      {/* Content skeleton */}
      <div className="max-w-[1200px] mx-auto px-4 py-6">
        <StatsGridSkeleton className="mb-6" />
        <CardSkeleton />
      </div>
    </div>
  )
}

/**
 * Inline loading indicator
 */
export function LoadingDots({ className }: SkeletonProps) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:-0.3s]" />
      <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:-0.15s]" />
      <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" />
    </span>
  )
}

/**
 * Centered spinner loading state
 */
export function LoadingSpinner({
  className,
  text = 'Loading',
}: SkeletonProps & { text?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-12',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          {text}
        </span>
      </div>
    </div>
  )
}
