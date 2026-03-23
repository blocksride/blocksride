import { PrivyProvider } from '@privy-io/react-auth'
import { WagmiProvider } from 'wagmi'
import { base, baseSepolia } from 'wagmi/chains'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createConfig } from '@privy-io/wagmi'
import { http } from 'wagmi'
import { getRuntimeNetworkConfig } from '@/lib/networkConfig'

const runtimeNetworkConfig = getRuntimeNetworkConfig()
const wagmiChains = [base, baseSepolia] as const

export const activeChain = runtimeNetworkConfig.chain
export const expectedChainId = runtimeNetworkConfig.chainId
export const networkName = runtimeNetworkConfig.networkName

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 30000,
      refetchOnWindowFocus: false,
      staleTime: 10000,
    },
  },
})

// Privy wagmi config
export const rpcUrl: string | undefined = import.meta.env.VITE_RPC_URL || undefined

const wagmiConfig = createConfig({
  chains: wagmiChains,
  transports: {
    [base.id]: http(runtimeNetworkConfig.network === 'mainnet' ? rpcUrl : undefined),
    [baseSepolia.id]: http(runtimeNetworkConfig.network === 'sepolia' ? rpcUrl : undefined),
  },
})

// Privy App ID from environment
const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || ''

export const Web3Provider = ({ children }: { children: React.ReactNode }) => {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email'],
        appearance: {
          theme: 'dark',
          accentColor: '#3b82f6',
          logo: '/blocksride-logo-white.png',
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'all-users', // always create embedded wallet for email users
          },
        },
        defaultChain: activeChain,
        supportedChains: [activeChain],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  )
}
