import { ReactNode } from 'react'
import { LucideIcon, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
    variant?: 'default' | 'outline' | 'secondary' | 'ghost'
  }
  secondaryAction?: {
    label: string
    onClick: () => void
  }
  children?: ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: {
    container: 'min-h-[200px] gap-3 p-4',
    icon: 'h-10 w-10',
    iconWrapper: 'h-12 w-12',
    title: 'text-base',
    description: 'text-xs',
  },
  md: {
    container: 'min-h-[300px] gap-4 p-6',
    icon: 'h-12 w-12',
    iconWrapper: 'h-16 w-16',
    title: 'text-lg',
    description: 'text-sm',
  },
  lg: {
    container: 'min-h-[400px] gap-6 p-8',
    icon: 'h-16 w-16',
    iconWrapper: 'h-20 w-20',
    title: 'text-xl',
    description: 'text-base',
  },
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  secondaryAction,
  children,
  className,
  size = 'md',
}: EmptyStateProps) {
  const sizes = sizeClasses[size]

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        sizes.container,
        className
      )}
      role="status"
      aria-label={title}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-full bg-muted',
          sizes.iconWrapper
        )}
      >
        <Icon
          className={cn('text-muted-foreground', sizes.icon)}
          aria-hidden="true"
        />
      </div>

      <div className="space-y-1">
        <h3 className={cn('font-semibold text-foreground', sizes.title)}>
          {title}
        </h3>
        {description && (
          <p className={cn('text-muted-foreground', sizes.description)}>
            {description}
          </p>
        )}
      </div>

      {children}

      {(action || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {action && (
            <Button
              variant={action.variant ?? 'default'}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="ghost" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// Pre-configured empty states for common scenarios
export function NoPositionsEmpty({ onStartTrading }: { onStartTrading?: () => void }) {
  return (
    <EmptyState
      title="No positions yet"
      description="Start trading to see your positions here."
      action={
        onStartTrading
          ? { label: 'Start trading', onClick: onStartTrading }
          : undefined
      }
    />
  )
}

export function NoHistoryEmpty() {
  return (
    <EmptyState
      title="No transaction history"
      description="Your trading history will appear here once you start making predictions."
    />
  )
}

export function NoContestsEmpty() {
  return (
    <EmptyState
      title="No contests available"
      description="Check back later for upcoming contests."
    />
  )
}

export function NoNotificationsEmpty() {
  return (
    <EmptyState
      title="No notifications"
      description="You're all caught up! New notifications will appear here."
      size="sm"
    />
  )
}

export function NoSearchResultsEmpty({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <EmptyState
      title="No results found"
      description={`We couldn't find anything matching "${query}".`}
      action={{ label: 'Clear search', onClick: onClear, variant: 'outline' }}
    />
  )
}

export default EmptyState
