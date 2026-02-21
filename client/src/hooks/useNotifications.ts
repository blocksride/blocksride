import { useState, useEffect, useCallback, useRef } from 'react'

type NotificationPermission = 'default' | 'granted' | 'denied'

interface NotificationOptions {
  title: string
  body?: string
  icon?: string
  tag?: string
  requireInteraction?: boolean
  silent?: boolean
  onClick?: () => void
}

interface UseNotificationsReturn {
  permission: NotificationPermission
  isSupported: boolean
  requestPermission: () => Promise<NotificationPermission>
  sendNotification: (options: NotificationOptions) => Notification | null
  soundEnabled: boolean
  setSoundEnabled: (enabled: boolean) => void
  playSound: (type: 'win' | 'loss' | 'alert') => void
}

// Sound URLs (can be replaced with actual sound files)
const SOUNDS = {
  win: '/sounds/win.mp3',
  loss: '/sounds/loss.mp3',
  alert: '/sounds/alert.mp3',
}

const STORAGE_KEY_SOUND = 'blip_sound_enabled'
const STORAGE_KEY_PERMISSION_ASKED = 'blip_notification_permission_asked'

export function useNotifications(): UseNotificationsReturn {
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [soundEnabled, setSoundEnabledState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY_SOUND)
    return stored !== null ? stored === 'true' : true // Default to enabled
  })

  const audioRef = useRef<HTMLAudioElement | null>(null)

  const isSupported = typeof window !== 'undefined' && 'Notification' in window

  // Check current permission on mount
  useEffect(() => {
    if (isSupported) {
      setPermission(Notification.permission)
    }
  }, [isSupported])

  // Persist sound preference
  const setSoundEnabled = useCallback((enabled: boolean) => {
    setSoundEnabledState(enabled)
    localStorage.setItem(STORAGE_KEY_SOUND, String(enabled))
  }, [])

  // Request notification permission
  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!isSupported) {
      return 'denied'
    }

    // Already granted or denied
    if (Notification.permission !== 'default') {
      return Notification.permission
    }

    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      localStorage.setItem(STORAGE_KEY_PERMISSION_ASKED, 'true')
      return result
    } catch (error) {
      console.error('Failed to request notification permission:', error)
      return 'denied'
    }
  }, [isSupported])

  // Send a notification
  const sendNotification = useCallback(
    (options: NotificationOptions): Notification | null => {
      if (!isSupported || permission !== 'granted') {
        return null
      }

      try {
        const notification = new Notification(options.title, {
          body: options.body,
          icon: options.icon || '/logo/blip-logo-white.png',
          tag: options.tag,
          requireInteraction: options.requireInteraction,
          silent: options.silent ?? !soundEnabled,
        })

        if (options.onClick) {
          notification.onclick = () => {
            window.focus()
            options.onClick?.()
            notification.close()
          }
        }

        return notification
      } catch (error) {
        console.error('Failed to send notification:', error)
        return null
      }
    },
    [isSupported, permission, soundEnabled]
  )

  // Play sound effect
  const playSound = useCallback(
    (type: 'win' | 'loss' | 'alert') => {
      if (!soundEnabled) return

      try {
        // Create audio element if needed
        if (!audioRef.current) {
          audioRef.current = new Audio()
        }

        const audio = audioRef.current
        audio.src = SOUNDS[type]
        audio.volume = 0.5
        audio.play().catch(() => {
          // Autoplay might be blocked - ignore
        })
      } catch (error) {
        console.error('Failed to play sound:', error)
      }
    },
    [soundEnabled]
  )

  return {
    permission,
    isSupported,
    requestPermission,
    sendNotification,
    soundEnabled,
    setSoundEnabled,
    playSound,
  }
}

/**
 * Hook to automatically request notification permission after first trade
 */
export function useNotificationPrompt() {
  const { permission, isSupported, requestPermission } = useNotifications()
  const [hasPrompted, setHasPrompted] = useState(() => {
    return localStorage.getItem(STORAGE_KEY_PERMISSION_ASKED) === 'true'
  })

  const promptForPermission = useCallback(async () => {
    if (!isSupported || permission !== 'default' || hasPrompted) {
      return
    }

    setHasPrompted(true)
    await requestPermission()
  }, [isSupported, permission, hasPrompted, requestPermission])

  return { promptForPermission, hasPrompted }
}

/**
 * Pre-configured notification helpers
 */
export function useTradeNotifications() {
  const { sendNotification, playSound, permission } = useNotifications()

  const notifyWin = useCallback(
    (amount: number, asset: string) => {
      playSound('win')
      sendNotification({
        title: 'Prediction Won!',
        body: `You won $${amount.toFixed(2)} on ${asset}`,
        tag: 'trade-result',
      })
    },
    [sendNotification, playSound]
  )

  const notifyLoss = useCallback(
    (amount: number, asset: string) => {
      playSound('loss')
      sendNotification({
        title: 'Prediction Lost',
        body: `You lost $${amount.toFixed(2)} on ${asset}`,
        tag: 'trade-result',
      })
    },
    [sendNotification, playSound]
  )

  const notifyContestStart = useCallback(
    (contestName: string) => {
      playSound('alert')
      sendNotification({
        title: 'Contest Starting!',
        body: `${contestName} is now live`,
        tag: 'contest',
        requireInteraction: true,
        onClick: () => {
          window.location.href = '/terminal'
        },
      })
    },
    [sendNotification, playSound]
  )

  const notifyContestEnd = useCallback(
    (contestName: string, rank?: number) => {
      playSound('alert')
      sendNotification({
        title: 'Contest Ended',
        body: rank
          ? `${contestName} has ended. You finished #${rank}`
          : `${contestName} has ended`,
        tag: 'contest',
      })
    },
    [sendNotification, playSound]
  )

  return {
    notifyWin,
    notifyLoss,
    notifyContestStart,
    notifyContestEnd,
    canNotify: permission === 'granted',
  }
}

export default useNotifications
