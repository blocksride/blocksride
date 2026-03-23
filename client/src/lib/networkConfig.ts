import { base, baseSepolia } from 'wagmi/chains'

export type BlocksrideNetwork = 'mainnet' | 'sepolia'

export interface RuntimeNetworkConfig {
    network: BlocksrideNetwork
    chain: typeof base | typeof baseSepolia
    chainId: number
    networkName: string
    usdcTokenAddress: `0x${string}`
    basescanTxBaseUrl: string
    fundingUrl: string
    fundingLabel: string
    fundingInstructions: string
    fundingHelpText: string
}

export const MAINNET_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
export const SEPOLIA_USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
export const BASE_SEPOLIA_FAUCET_URL = 'https://www.coinbase.com/developer-platform/products/faucet' as const
export const BASE_MAINNET_BRIDGE_URL = 'https://bridge.base.org/deposit' as const

export function getRuntimeNetwork(): BlocksrideNetwork {
    return (import.meta.env.VITE_NETWORK || 'mainnet') === 'sepolia' ? 'sepolia' : 'mainnet'
}

export function getRuntimeNetworkConfig(network: BlocksrideNetwork = getRuntimeNetwork()): RuntimeNetworkConfig {
    if (network === 'sepolia') {
        return {
            network,
            chain: baseSepolia,
            chainId: baseSepolia.id,
            networkName: 'Base Sepolia',
            usdcTokenAddress: SEPOLIA_USDC_ADDRESS,
            basescanTxBaseUrl: 'https://sepolia.basescan.org/tx',
            fundingUrl: BASE_SEPOLIA_FAUCET_URL,
            fundingLabel: 'Top Up Wallet',
            fundingInstructions: 'Top up your embedded wallet with Base Sepolia USDC, then refresh your balance.',
            fundingHelpText:
                'Use the funding link to send Base Sepolia USDC to your embedded wallet, then return here and refresh your balance.',
        }
    }

    return {
        network,
        chain: base,
        chainId: base.id,
        networkName: 'Base',
        usdcTokenAddress: MAINNET_USDC_ADDRESS,
        basescanTxBaseUrl: 'https://basescan.org/tx',
        fundingUrl: BASE_MAINNET_BRIDGE_URL,
        fundingLabel: 'Top Up Wallet',
        fundingInstructions: 'Top up your embedded wallet with Base USDC, then refresh your balance.',
        fundingHelpText: 'Use the funding link to send Base USDC to your embedded wallet, then return here and refresh your balance.',
    }
}
