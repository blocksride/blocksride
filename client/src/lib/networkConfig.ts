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
export const BASEPESA_URL = 'https://basepesa.com' as const

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
            fundingUrl: BASEPESA_URL,
            fundingLabel: 'Fund with BasePesa',
            fundingInstructions: 'Fund your embedded wallet, then refresh your balance.',
            fundingHelpText:
                'Use BasePesa to send USDC to your embedded wallet, then return here and refresh your balance.',
        }
    }

    return {
        network,
        chain: base,
        chainId: base.id,
        networkName: 'Base',
        usdcTokenAddress: MAINNET_USDC_ADDRESS,
        basescanTxBaseUrl: 'https://basescan.org/tx',
        fundingUrl: BASEPESA_URL,
        fundingLabel: 'Fund with BasePesa',
        fundingInstructions: 'Fund your embedded wallet, then refresh your balance.',
        fundingHelpText: 'Use BasePesa to send USDC to your embedded wallet, then return here and refresh your balance.',
    }
}
