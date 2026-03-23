import { PrivyProvider } from '@privy-io/react-auth'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createConfig } from '@privy-io/wagmi'
import { http } from 'wagmi'
import { getRuntimeNetworkConfig } from '@/lib/networkConfig'

const runtimeNetworkConfig = getRuntimeNetworkConfig()
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
const wagmiConfig = createConfig({
  chains: [activeChain],
  transports: {
    [activeChain.id]: http(),
  },
})

// Privy App ID from environment
const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || ''

export const Web3Provider = ({ children }: { children: React.ReactNode }) => {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#3b82f6', // Blue accent
          logo: '/logo/blip-logo-white.png',
          // embedded wallet first = seamless (no pop-ups); metamask shown as secondary option
          walletList: ['detected_wallets', 'metamask', 'coinbase_wallet'],
          showWalletLoginFirst: false,
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
