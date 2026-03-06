import { PrivyProvider } from '@privy-io/react-auth'
import { WagmiProvider } from 'wagmi'
import { base, baseSepolia } from 'wagmi/chains'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createConfig } from '@privy-io/wagmi'
import { http } from 'wagmi'

// Select network based on environment variable
// mainnet = Base, sepolia = Base Sepolia
const network = import.meta.env.VITE_NETWORK || 'mainnet'
export const activeChain = network === 'sepolia' ? baseSepolia : base
export const expectedChainId = activeChain.id
export const networkName = network === 'sepolia' ? 'Base Sepolia' : 'Base'

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
    [base.id]: http(),
    [baseSepolia.id]: http(),
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
