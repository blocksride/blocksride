import { useReadContract, useAccount } from 'wagmi'

const erc20Abi = [
    {
        inputs: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
        ],
        name: 'allowance',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const

export function useAllowance() {
    const { address, isConnected } = useAccount()

    // USDC token address (Base Mainnet)
    const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    // Treasury address (Base Mainnet)
    const TREASURY_ADDRESS = import.meta.env.VITE_PLATFORM_TREASURY || ''

    const { data: allowance, refetch } = useReadContract({
        address: TOKEN_ADDRESS as `0x${string}`,
        abi: erc20Abi,
        functionName: 'allowance',
        args: address && TREASURY_ADDRESS ? [address, TREASURY_ADDRESS as `0x${string}`] : undefined,
        query: {
            enabled: !!address && isConnected,
        },
    })

    const isApproved = allowance ? allowance > 0n : false

    return {
        allowance: allowance || 0n,
        isApproved,
        refetch,
    }
}
