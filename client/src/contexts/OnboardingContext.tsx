import React, { createContext, useContext, useState, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { authService } from '../services/authService'

interface OnboardingContextType {
    isOnboardingActive: boolean
    currentStep: number
    totalSteps: number
    startOnboarding: () => void
    nextStep: () => void
    previousStep: () => void
    skipOnboarding: () => Promise<void>
    completeOnboarding: () => Promise<void>
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined)

export const OnboardingProvider = ({ children }: { children: React.ReactNode }) => {
    const { refreshUser } = useAuth()
    const [isOnboardingActive, setIsOnboardingActive] = useState(false)
    const [currentStep, setCurrentStep] = useState(0)
    const totalSteps = 3 // Total tutorial steps

    const startOnboarding = useCallback(() => {
        setIsOnboardingActive(true)
        setCurrentStep(0)
    }, [])

    const nextStep = useCallback(() => {
        setCurrentStep(prev => Math.min(prev + 1, totalSteps - 1))
    }, [totalSteps])

    const previousStep = useCallback(() => {
        setCurrentStep(prev => Math.max(prev - 1, 0))
    }, [])

    const skipOnboarding = useCallback(async () => {
        try {
            await authService.completeOnboarding()
            await refreshUser()
        } catch (error) {
            console.error('Failed to skip onboarding:', error)
        } finally {
            setIsOnboardingActive(false)
            setCurrentStep(0)
        }
    }, [refreshUser])

    const completeOnboarding = useCallback(async () => {
        try {
            await authService.completeOnboarding()
            await refreshUser()
        } catch (error) {
            console.error('Failed to complete onboarding:', error)
        } finally {
            setIsOnboardingActive(false)
            setCurrentStep(0)
        }
    }, [refreshUser])

    return (
        <OnboardingContext.Provider
            value={{
                isOnboardingActive,
                currentStep,
                totalSteps,
                startOnboarding,
                nextStep,
                previousStep,
                skipOnboarding,
                completeOnboarding,
            }}
        >
            {children}
        </OnboardingContext.Provider>
    )
}

export const useOnboarding = () => {
    const context = useContext(OnboardingContext)
    if (!context) {
        throw new Error('useOnboarding must be used within OnboardingProvider')
    }
    return context
}
