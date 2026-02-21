import { useState, useEffect } from 'react'
import { Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NetworkStatusProps {
  className?: string
  showLabel?: boolean
  compact?: boolean
}

type ConnectionState = 'online' | 'offline' | 'reconnecting'

export function NetworkStatus({
  className,
  showLabel = true,
  compact = false,
}: NetworkStatusProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    navigator.onLine ? 'online' : 'offline'
  )
  const [wsConnected, setWsConnected] = useState(true)

  // Monitor browser online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setConnectionState('reconnecting')
      // Give a brief moment before showing online to allow connections to restore
      setTimeout(() => setConnectionState('online'), 1000)
    }

    const handleOffline = () => {
      setConnectionState('offline')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Listen for WebSocket status events (dispatched from useGridSocket, etc.)
  useEffect(() => {
    const handleWsStatus = (event: CustomEvent<{ connected: boolean }>) => {
      setWsConnected(event.detail.connected)
      if (!event.detail.connected && connectionState === 'online') {
        setConnectionState('reconnecting')
      } else if (event.detail.connected && connectionState === 'reconnecting') {
        setConnectionState('online')
      }
    }

    window.addEventListener('ws-status' as keyof WindowEventMap, handleWsStatus as EventListener)

    return () => {
      window.removeEventListener('ws-status' as keyof WindowEventMap, handleWsStatus as EventListener)
    }
  }, [connectionState])

  const getStatusConfig = () => {
    switch (connectionState) {
      case 'online':
        return {
          icon: Wifi,
          label: 'Connected',
          color: 'text-green-500',
          bgColor: 'bg-green-500/10',
          borderColor: 'border-green-500/30',
          pulse: false,
        }
      case 'offline':
        return {
          icon: WifiOff,
          label: 'Offline',
          color: 'text-red-500',
          bgColor: 'bg-red-500/10',
          borderColor: 'border-red-500/30',
          pulse: false,
        }
      case 'reconnecting':
        return {
          icon: RefreshCw,
          label: 'Reconnecting',
          color: 'text-yellow-500',
          bgColor: 'bg-yellow-500/10',
          borderColor: 'border-yellow-500/30',
          pulse: true,
        }
    }
  }

  const config = getStatusConfig()
  const Icon = config.icon

  // Don't show anything when online and connected (unless explicitly showing)
  if (connectionState === 'online' && wsConnected && !showLabel) {
    return null
  }

  if (compact) {
    return (
      <div
        className={cn('flex items-center gap-1', className)}
        role="status"
        aria-label={`Network status: ${config.label}`}
      >
        <Icon
          className={cn(
            'w-3 h-3',
            config.color,
            config.pulse && 'animate-spin'
          )}
          aria-hidden="true"
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-mono',
        config.bgColor,
        config.borderColor,
        className
      )}
      role="status"
      aria-label={`Network status: ${config.label}`}
    >
      <Icon
        className={cn('w-3 h-3', config.color, config.pulse && 'animate-spin')}
        aria-hidden="true"
      />
      {showLabel && (
        <span className={cn('uppercase tracking-wider', config.color)}>
          {config.label}
        </span>
      )}
    </div>
  )
}

/**
 * Offline banner that shows at top of page when offline
 */
export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (!isOffline) return null

  return (
    <div
      className="bg-red-500 text-white text-center py-2 text-xs font-mono"
      role="alert"
    >
      <WifiOff className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
      You are offline. Some features may not be available.
    </div>
  )
}

/**
 * Hook to track online/offline status
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return isOnline
}

/**
 * Helper to dispatch WebSocket status events
 * Call this from your WebSocket hooks when connection state changes
 */
export function dispatchWsStatus(connected: boolean) {
  window.dispatchEvent(
    new CustomEvent('ws-status', { detail: { connected } })
  )
}

export default NetworkStatus
