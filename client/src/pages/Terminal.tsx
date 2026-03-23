import { GridVisualizer } from '@/components/GridVisualizer'
import { ContestHub } from '@/components/contest/ContestHub'
import { ContestWaiting } from '@/components/contest/ContestWaiting'
import { TerminalHeader } from '@/components/terminal/TerminalHeader'
import { GuestTerminal } from '@/components/terminal/GuestTerminal'
import { useAccount } from 'wagmi'
import { useEffect } from 'react'
import { useContest } from '@/contexts/ContestContext'
import { useAuth } from '@/contexts/AuthContext'
import { useOnboarding } from '@/contexts/OnboardingContext'
import { toast } from 'sonner'
import { useTokenBalance } from '@/hooks/useTokenBalance'

const ADD_FUNDS_PROMPT_KEY = 'blocksride_add_funds_prompted'

export const Terminal = () => {
    useAccount() // Keep for wagmi state
    const { authenticated, loading, user } = useAuth()
    const { formatted: onchainUsdcBalance } = useTokenBalance()
    const { selectedContest, sessionMode, isWaitingForStart } = useContest()
    const { startOnboarding, isOnboardingActive } = useOnboarding()

    // Check if user needs onboarding
    useEffect(() => {
        if (!loading && authenticated && user && !user.has_seen_betting_onboarding && !isOnboardingActive) {
            const timer = setTimeout(() => {
                startOnboarding()
            }, 500)
            return () => clearTimeout(timer)
        }
    }, [loading, authenticated, user, startOnboarding, isOnboardingActive])

    useEffect(() => {
        if (loading || !authenticated || !user) return
        if (Number(onchainUsdcBalance ?? 0) > 0) return
        if (typeof window === 'undefined') return

        const prompted = localStorage.getItem(ADD_FUNDS_PROMPT_KEY) === 'true'
        if (prompted) return

        toast.info('Add funds to start betting.', {
            action: {
                label: 'Add Funds',
                onClick: () => {
                    document.querySelector<HTMLButtonElement>('[data-wallet-trigger]')?.click()
                },
            },
        })

        localStorage.setItem(ADD_FUNDS_PROMPT_KEY, 'true')
    }, [loading, authenticated, user, onchainUsdcBalance])

    // Show nothing while checking auth
    if (loading) {
        return null
    }

    if (!authenticated) {
        return (
            <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden dark">
                <TerminalHeader />
                <GuestTerminal assetId="ETH-USD" />
            </div>
        )
    }

    // Show contest hub when in selection mode
    if (sessionMode === 'selecting') {
        return <ContestHub />
    }

    // Show waiting screen if contest hasn't started yet
    if (isWaitingForStart) {
        return <ContestWaiting />
    }

    // Get the asset ID from selected contest or default to ETH-USD
    const assetId = selectedContest?.asset_id || 'ETH-USD'

    return (
        <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden dark">
            <TerminalHeader />
            <div className="flex-1 min-h-0">
                <GridVisualizer assetId={assetId} />
            </div>
            <a
                href="https://t.me/blocksride"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground border-t border-border bg-background transition-colors"
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.32 13.617l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.828.942z"/>
                </svg>
                Join the community on Telegram
            </a>
        </div>
    )
}
