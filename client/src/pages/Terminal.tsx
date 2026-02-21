import { GridVisualizer } from '@/components/GridVisualizer'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { ContestHub } from '@/components/contest/ContestHub'
import { ContestWaiting } from '@/components/contest/ContestWaiting'
import { TerminalHeader } from '@/components/terminal/TerminalHeader'
import { useAccount } from 'wagmi'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useContest } from '@/contexts/ContestContext'
import { useAuth } from '@/contexts/AuthContext'
import { useOnboarding } from '@/contexts/OnboardingContext'

export const Terminal = () => {
    useAccount() // Keep for wagmi state
    const { authenticated, loading, user } = useAuth()
    const navigate = useNavigate()
    const { selectedContest, sessionMode, isWaitingForStart } = useContest()
    const { startOnboarding, isOnboardingActive } = useOnboarding()

    // Redirect to landing if not authenticated
    useEffect(() => {
        if (!loading && !authenticated) {
            navigate('/')
        }
    }, [loading, authenticated, navigate])

    // Check if user needs onboarding
    useEffect(() => {
        if (!loading && authenticated && user && !user.has_seen_betting_onboarding && !isOnboardingActive) {
            const timer = setTimeout(() => {
                startOnboarding()
            }, 500)
            return () => clearTimeout(timer)
        }
    }, [loading, authenticated, user, startOnboarding, isOnboardingActive])

    // Show nothing while checking auth
    if (loading || !authenticated) {
        return null
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
