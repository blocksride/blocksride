import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useReadContracts } from 'wagmi'
import { formatUnits } from 'viem'
import { User } from '../types/auth'
import { authService } from '../services/authService'
import { getRuntimeNetworkConfig } from '@/lib/networkConfig'

const { usdcTokenAddress } = getRuntimeNetworkConfig()

const erc20Abi = [
    { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
    { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
] as const

interface AuthContextType {
    user: User | null
    loading: boolean
    authenticated: boolean
    walletAddress: string | null
    signIn: () => void
    signOut: () => void
    refreshUser: () => Promise<void>
    // token balance — single shared subscription
    usdcBalance: bigint
    usdcFormatted: string
    usdcDecimals: number
    refetchBalance: () => void
    isRefetchingBalance: boolean
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

    // Get embedded Privy wallet (walletClientType can vary by SDK version).
    const embeddedWallet = wallets.find((w) =>
        (w.walletClientType || '').toLowerCase().includes('privy'),
    )
    const activeWallet = embeddedWallet || wallets[0]

    const tokenAddress = (import.meta.env.VITE_TOKEN_ADDRESS || usdcTokenAddress) as `0x${string}`
    const balanceAddress = (walletAddress || activeWallet?.address) as `0x${string}` | undefined
    const { data: balanceReads, refetch: refetchBalance, isRefetching: isRefetchingBalance } = useReadContracts({
        contracts: [
            { address: tokenAddress, abi: erc20Abi, functionName: 'decimals' },
            { address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [balanceAddress!] },
        ],
        query: { enabled: !!balanceAddress, refetchInterval: 30000 },
    })
    const usdcDecimals = (balanceReads?.[0]?.result as number | undefined) ?? 6
    const usdcBalance = (balanceReads?.[1]?.result as bigint | undefined) ?? 0n
    const usdcFormatted = formatUnits(usdcBalance, usdcDecimals)

    // Sync Privy auth state with backend
    const syncAuth = useCallback(async () => {
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
    }, [privyAuthenticated, privyUser, ready, getAccessToken, activeWallet?.address, authSynced])

    useEffect(() => {
        syncAuth()
    }, [syncAuth])

    // Update wallet address when wallet changes
    useEffect(() => {
        if (activeWallet?.address) {
            setWalletAddress(activeWallet.address)
        }
    }, [activeWallet?.address])

    // Sign in with Privy
    const signIn = useCallback(() => {
        if (privyAuthenticated) {
            // Privy already has a session but backend sync failed — retry sync
            // instead of calling login() again (which Privy would reject)
            setAuthSynced(false)
            syncAuth()
        } else {
            // DO NOT call setLoading(true) here.
            // If the user opens then dismisses the Privy modal, privyAuthenticated
            // stays false and none of the syncAuth deps change, so the effect never
            // re-fires — loading would be permanently stuck at true, freezing the UI.
            // The syncAuth effect sets loading=true itself when backend sync begins.
            login()
        }
    }, [login, privyAuthenticated, syncAuth])

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
            value={{ user, loading, authenticated, walletAddress, signIn, signOut, refreshUser, usdcBalance, usdcFormatted, usdcDecimals, refetchBalance, isRefetchingBalance }}
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
