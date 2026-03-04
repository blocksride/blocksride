import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { User } from '../types/auth'
import { authService } from '../services/authService'

interface AuthContextType {
    user: User | null
    loading: boolean
    authenticated: boolean
    walletAddress: string | null
    signIn: () => Promise<void>
    signOut: () => void
    refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

interface AuthProviderProps {
    children: React.ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
    const { login, logout, authenticated: privyAuthenticated, ready, getAccessToken, user: privyUser } = usePrivy()
    const { wallets } = useWallets()

    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState(true)
    const [authenticated, setAuthenticated] = useState(false)
    const [walletAddress, setWalletAddress] = useState<string | null>(null)
    const [authSynced, setAuthSynced] = useState(false)

    // Get the embedded wallet address
    const embeddedWallet = wallets.find(w => w.walletClientType === 'privy')
    const activeWallet = embeddedWallet || wallets[0]

    // Sync Privy auth state with backend
    useEffect(() => {
        const syncAuth = async () => {
            if (!ready) {
                return
            }

            if (privyAuthenticated && privyUser && !authSynced) {
                try {
                    setLoading(true)
                    // Get Privy access token
                    const privyToken = await getAccessToken()

                    if (!privyToken) {
                        throw new Error('Failed to get Privy access token')
                    }

                    // Exchange Privy token for platform JWT cookie
                    const walletAddr = activeWallet?.address || ''
                    const { user: userData } = await authService.verifyPrivy(privyToken, walletAddr)

                    setUser(userData)
                    setWalletAddress(walletAddr)
                    setAuthenticated(true)
                    setAuthSynced(true)
                } catch (error) {
                    console.error('Failed to sync Privy auth with backend:', error)
                    // Try to get existing session
                    try {
                        const userData = await authService.getUser()
                        setUser(userData)
                        setAuthenticated(true)
                        setAuthSynced(true)
                        if (activeWallet?.address) {
                            setWalletAddress(activeWallet.address)
                        }
                    } catch {
                        // No valid session
                        setUser(null)
                        setAuthenticated(false)
                        setAuthSynced(false)
                    }
                } finally {
                    setLoading(false)
                }
            } else if (!privyAuthenticated) {
                // User is not authenticated with Privy
                // Check for existing platform session
                try {
                    const userData = await authService.getUser()
                    setUser(userData)
                    setAuthenticated(true)
                } catch {
                    setUser(null)
                    setAuthenticated(false)
                }
                setAuthSynced(false)
                setLoading(false)
            } else {
                setLoading(false)
            }
        }

        syncAuth()
    }, [privyAuthenticated, privyUser, ready, getAccessToken, activeWallet?.address, authSynced])

    // Update wallet address when wallet changes
    useEffect(() => {
        if (activeWallet?.address) {
            setWalletAddress(activeWallet.address)
        }
    }, [activeWallet?.address])

    // Sign in with Privy
    const signIn = useCallback(async () => {
        try {
            // Open Privy login modal
            login()
            // Auth sync happens automatically via useEffect when privyAuthenticated changes
        } catch (error) {
            console.error('Sign in failed:', error)
            throw error
        }
    }, [login])

    // Sign out
    const signOut = useCallback(async () => {
        try {
            await authService.logout()
        } catch {
            // Ignore logout errors
        }
        setUser(null)
        setAuthenticated(false)
        setWalletAddress(null)
        setAuthSynced(false)
        logout()
    }, [logout])

    // Refresh user data
    const refreshUser = useCallback(async () => {
        try {
            const userData = await authService.getUser()
            setUser(userData)
        } catch {
            // Session might be invalid
            setUser(null)
            setAuthenticated(false)
        }
    }, [])

    return (
        <AuthContext.Provider
            value={{ user, loading, authenticated, walletAddress, signIn, signOut, refreshUser }}
        >
            {children}
        </AuthContext.Provider>
    )
}

export const useAuth = () => {
    const context = useContext(AuthContext)
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider')
    }
    return context
}
