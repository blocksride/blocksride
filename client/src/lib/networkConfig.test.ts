import { afterEach, describe, expect, it, vi } from 'vitest'

async function importConfig() {
    return await import('./networkConfig')
}

afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
})

describe('networkConfig', () => {
    it('defaults to Base mainnet runtime config', async () => {
        vi.stubEnv('VITE_NETWORK', '')
        const { getRuntimeNetwork, getRuntimeNetworkConfig, MAINNET_USDC_ADDRESS } = await importConfig()

        expect(getRuntimeNetwork()).toBe('mainnet')

        const config = getRuntimeNetworkConfig()
        expect(config.network).toBe('mainnet')
        expect(config.chainId).toBe(8453)
        expect(config.networkName).toBe('Base')
        expect(config.usdcTokenAddress).toBe(MAINNET_USDC_ADDRESS)
        expect(config.basescanTxBaseUrl).toBe('https://basescan.org/tx')
        expect(config.fundingUrl).toBe('https://basepesa.com')
        expect(config.fundingLabel).toBe('Fund with BasePesa')
        expect(config.fundingInstructions).toContain('Fund your embedded wallet')
    })

    it('resolves Base mainnet config explicitly', async () => {
        vi.stubEnv('VITE_NETWORK', 'mainnet')
        const { getRuntimeNetworkConfig, MAINNET_USDC_ADDRESS } = await importConfig()

        const config = getRuntimeNetworkConfig()
        expect(config.chainId).toBe(8453)
        expect(config.usdcTokenAddress).toBe(MAINNET_USDC_ADDRESS)
        expect(config.basescanTxBaseUrl).toBe('https://basescan.org/tx')
        expect(config.fundingUrl).toBe('https://basepesa.com')
        expect(config.networkName).toBe('Base')
        expect(config.basescanTxBaseUrl.toLowerCase()).not.toContain('sepolia')
        expect(config.fundingLabel).toBe('Fund with BasePesa')
        expect(config.fundingInstructions.toLowerCase()).not.toContain('sepolia')
    })

    it('still supports Base Sepolia when explicitly selected', async () => {
        vi.stubEnv('VITE_NETWORK', 'sepolia')
        const { getRuntimeNetwork, getRuntimeNetworkConfig, SEPOLIA_USDC_ADDRESS } = await importConfig()

        expect(getRuntimeNetwork()).toBe('sepolia')

        const config = getRuntimeNetworkConfig()
        expect(config.chainId).toBe(84532)
        expect(config.networkName).toBe('Base Sepolia')
        expect(config.usdcTokenAddress).toBe(SEPOLIA_USDC_ADDRESS)
        expect(config.basescanTxBaseUrl).toBe('https://sepolia.basescan.org/tx')
        expect(config.fundingLabel).toBe('Fund with BasePesa')
    })

    it('falls back to mainnet for unknown network values', async () => {
        vi.stubEnv('VITE_NETWORK', 'staging')
        const { getRuntimeNetwork, getRuntimeNetworkConfig, MAINNET_USDC_ADDRESS } = await importConfig()

        expect(getRuntimeNetwork()).toBe('mainnet')

        const config = getRuntimeNetworkConfig()
        expect(config.chainId).toBe(8453)
        expect(config.usdcTokenAddress).toBe(MAINNET_USDC_ADDRESS)
        expect(config.basescanTxBaseUrl).toBe('https://basescan.org/tx')
        expect(config.fundingUrl).toBe('https://basepesa.com')
    })
})
