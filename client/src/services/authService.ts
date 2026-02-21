import axiosInstance from '../utility/axiosInterceptor'
import { User } from '../types/auth'

export const authService = {
    // Privy Authentication - Exchange Privy token for platform JWT
    verifyPrivy: async (privyToken: string, walletAddress: string): Promise<{ user: User }> => {
        const response = await axiosInstance.post('/auth/privy', {
            wallet_address: walletAddress,
        }, {
            headers: {
                'Authorization': `Bearer ${privyToken}`,
            },
        })
        // Token is set as httpOnly cookie automatically
        return response.data
    },

    // Legacy SIWE Authentication (kept for admin panel)
    getNonce: async (address: string): Promise<string> => {
        const response = await axiosInstance.get(`/auth/nonce?address=${address}`)
        return response.data.nonce
    },

    verifySIWE: async (message: string, signature: string): Promise<{ user: User }> => {
        const response = await axiosInstance.post('/auth/verify', {
            message,
            signature,
        })
        // Token is now set as httpOnly cookie automatically
        return response.data
    },

    getUser: async (): Promise<User> => {
        // Cookie is sent automatically via withCredentials
        const response = await axiosInstance.get('/auth/me')
        return response.data
    },

    updateProfile: async (nickname: string): Promise<User> => {
        // Cookie is sent automatically via withCredentials
        const response = await axiosInstance.post('/users/profile', { nickname })
        return response.data.user
    },

    completeOnboarding: async (): Promise<void> => {
        // Cookie is sent automatically via withCredentials
        await axiosInstance.post('/auth/onboarding/complete', {})
    },

    logout: async (): Promise<void> => {
        // Clear the httpOnly cookie on the server
        await axiosInstance.post('/auth/logout')
    },
}
