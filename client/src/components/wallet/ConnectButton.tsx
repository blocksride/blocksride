import { usePrivy } from '@privy-io/react-auth'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'

interface ConnectButtonProps {
  className?: string
  children?: React.ReactNode
}

export const ConnectButton = ({ className, children }: ConnectButtonProps) => {
  const { login, logout, ready } = usePrivy()
  const { authenticated, walletAddress, loading } = useAuth()

  if (!ready || loading) {
    return (
      <Button
        disabled
        variant="outline"
        className={className}
      >
        Loading...
      </Button>
    )
  }

  if (authenticated && walletAddress) {
    return (
      <Button
        onClick={() => logout()}
        variant="outline"
        className={className}
      >
        {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
      </Button>
    )
  }

  return (
    <Button
      onClick={() => login()}
      className={className}
    >
      {children || 'Login'}
    </Button>
  )
}
