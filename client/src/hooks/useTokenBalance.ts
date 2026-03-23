import { useAuth } from '@/contexts/AuthContext'

/** Thin wrapper — reads from the single shared balance subscription in AuthContext. */
export function useTokenBalance() {
    const { walletAddress, usdcBalance, usdcFormatted, usdcDecimals, refetchBalance, isRefetchingBalance } = useAuth()

    return {
        balance: usdcBalance,
        formatted: usdcFormatted,
        decimals: usdcDecimals,
        refetch: refetchBalance,
        isRefetching: isRefetchingBalance,
        address: (walletAddress ?? undefined) as `0x${string}` | undefined,
        isConnected: !!walletAddress,
    }
}
