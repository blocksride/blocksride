import { useReadContracts } from 'wagmi'
import { useWallets } from '@privy-io/react-auth'
import { formatUnits } from 'viem'
import { useAuth } from '@/contexts/AuthContext'

const erc20Abi = [
    {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
    },
    {
        name: 'decimals',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint8' }],
    },
] as const

export function useTokenBalance() {
    // Prefer the authenticated wallet from AuthContext, then fall back to the embedded Privy wallet.
    const { wallets } = useWallets()
    const { walletAddress } = useAuth()
    const embeddedWallet = wallets.find(w => w.walletClientType === 'privy')
    const activeWallet = embeddedWallet || wallets[0]
    const address = (walletAddress || activeWallet?.address) as `0x${string}` | undefined
    const isConnected = !!address

    // USDC on Base Mainnet
    const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

    const { data: reads, refetch, isRefetching } = useReadContracts({
        contracts: [
            {
                address: TOKEN_ADDRESS as `0x${string}`,
                abi: erc20Abi,
                functionName: 'decimals',
            },
            {
                address: TOKEN_ADDRESS as `0x${string}`,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [address!],
            },
        ],
        query: {
            enabled: !!address && isConnected,
            refetchInterval: 30000,
        },
    })

    const decimals = reads?.[0]?.result ?? 6
    const balance = reads?.[1]?.result ?? 0n

    const formatted = formatUnits(balance, decimals)

    return {
        balance,
        formatted,
        decimals,
        refetch,
        isRefetching,
        address, // Expose the address being queried
        isConnected,
    }
}
