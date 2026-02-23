import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { api, Contest } from '../services/apiService'

type SessionMode = 'selecting' | 'practice' | 'contest'

interface ContestContextType {
    activeContest: Contest | null
    upcomingContests: Contest[]
    allContests: Contest[] // All available contests (active + upcoming)
    selectedContest: Contest | null
    sessionMode: SessionMode
    isPracticeMode: boolean
    isWaitingForStart: boolean // Selected contest hasn't started yet
    loading: boolean
    error: string | null
    timeRemaining: number | null // seconds remaining in selected contest
    timeUntilStart: number | null // seconds until selected contest starts
    refreshContests: () => Promise<void>
    selectContest: (contest: Contest | null) => void
    enterPracticeMode: () => void
    exitToSelection: () => void
}

const ContestContext = createContext<ContestContextType | undefined>(undefined)

interface ContestProviderProps {
    children: React.ReactNode
}

export const ContestProvider = ({ children }: ContestProviderProps) => {
    const [activeContest, setActiveContest] = useState<Contest | null>(null)
    const [upcomingContests, setUpcomingContests] = useState<Contest[]>([])
    const [selectedContest, setSelectedContest] = useState<Contest | null>(null)
    const [sessionMode, setSessionMode] = useState<SessionMode>('selecting')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
    const [timeUntilStart, setTimeUntilStart] = useState<number | null>(null)

    // Use refs to avoid circular dependencies in useEffect/useCallback
    const fetchContestsRef = useRef<() => Promise<void>>()
    const selectedContestRef = useRef<Contest | null>(null)
    const isFetchingRef = useRef(false)

    // Keep selectedContestRef in sync
    selectedContestRef.current = selectedContest

    const isPracticeMode = sessionMode === 'practice'
    const isWaitingForStart = sessionMode === 'contest' && selectedContest?.status === 'upcoming'
    const allContests = [...(activeContest ? [activeContest] : []), ...upcomingContests]

    // fetchContests with NO dependencies to prevent infinite loops
    const fetchContests = useCallback(async () => {
        // Prevent concurrent fetches
        if (isFetchingRef.current) return
        isFetchingRef.current = true

        try {
            setLoading(true)
            setError(null)

            const [activeRes, upcomingRes] = await Promise.all([
                api.getActiveContest(),
                api.getUpcomingContests(),
            ])

            const newActiveContest = activeRes.data.contest
            const newUpcomingContests = upcomingRes.data.contests || []

            setActiveContest(newActiveContest)
            setUpcomingContests(newUpcomingContests)

            // Update selected contest status if it changed (use ref to avoid dependency)
            const currentSelected = selectedContestRef.current
            if (currentSelected) {
                const updatedContest = newActiveContest?.contest_id === currentSelected.contest_id
                    ? newActiveContest
                    : newUpcomingContests.find(c => c.contest_id === currentSelected.contest_id)
                if (updatedContest) {
                    setSelectedContest(updatedContest)
                }
            }
        } catch {
            setError('Failed to load contest information')
        } finally {
            setLoading(false)
            isFetchingRef.current = false
        }
    }, []) // Empty dependency array - uses refs instead

    // Keep ref updated
    fetchContestsRef.current = fetchContests

    // Calculate time remaining/until start for selected contest
    useEffect(() => {
        if (!selectedContest || sessionMode !== 'contest') {
            setTimeRemaining(null)
            setTimeUntilStart(null)
            return
        }

        const updateTimers = () => {
            const now = Date.now()
            const startTime = new Date(selectedContest.start_time).getTime()
            const endTime = new Date(selectedContest.end_time).getTime()

            if (now < startTime) {
                // Contest hasn't started yet
                const newTimeUntilStart = Math.max(0, Math.floor((startTime - now) / 1000))
                setTimeUntilStart(prev => prev !== newTimeUntilStart ? newTimeUntilStart : prev)
                setTimeRemaining(prev => prev !== null ? null : prev)
            } else if (now < endTime) {
                // Contest is active
                const newTimeRemaining = Math.max(0, Math.floor((endTime - now) / 1000))
                setTimeUntilStart(prev => prev !== null ? null : prev)
                setTimeRemaining(prev => prev !== newTimeRemaining ? newTimeRemaining : prev)
            } else {
                // Contest has ended
                setTimeUntilStart(prev => prev !== null ? null : prev)
                setTimeRemaining(prev => prev !== 0 ? 0 : prev)
                fetchContestsRef.current?.()
            }
        }

        updateTimers()
        const interval = setInterval(updateTimers, 1000)

        return () => clearInterval(interval)
    }, [selectedContest, sessionMode])

    // Initial fetch - only runs once on mount
    useEffect(() => {
        fetchContests()
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Periodically refresh contest status
    useEffect(() => {
        const interval = setInterval(() => {
            fetchContestsRef.current?.()
        }, 30000) // every 30 seconds
        return () => clearInterval(interval)
    }, [])

    const refreshContests = async () => {
        await fetchContests()
    }

    const selectContest = (contest: Contest | null) => {
        setSelectedContest(contest)
        if (contest) {
            setSessionMode('contest')
        } else {
            setSessionMode('selecting')
        }
    }

    const enterPracticeMode = () => {
        setSelectedContest(null)
        setSessionMode('practice')
    }

    const exitToSelection = () => {
        setSelectedContest(null)
        setSessionMode('selecting')
    }

    return (
        <ContestContext.Provider
            value={{
                activeContest,
                upcomingContests,
                allContests,
                selectedContest,
                sessionMode,
                isPracticeMode,
                isWaitingForStart,
                loading,
                error,
                timeRemaining,
                timeUntilStart,
                refreshContests,
                selectContest,
                enterPracticeMode,
                exitToSelection,
            }}
        >
            {children}
        </ContestContext.Provider>
    )
}

export const useContest = () => {
    const context = useContext(ContestContext)
    if (!context) {
        throw new Error('useContest must be used within ContestProvider')
    }
    return context
}

// Helper function to format time remaining
export const formatTimeRemaining = (seconds: number): string => {
    if (seconds <= 0) return '0:00'

    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`
}
