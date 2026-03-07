import { GridVisualizer } from '@/components/GridVisualizer'
import { ChatWindow } from '@/components/chat/ChatWindow'
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
    const { selectedContest, sessionMode, isWaitingForStart, isPracticeMode } = useContest()
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
        if (loading || !authenticated || !user || isPracticeMode) return
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
    }, [loading, authenticated, user, isPracticeMode, onchainUsdcBalance])

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
            <ChatWindow />
        </div>
    )
}
