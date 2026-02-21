import { ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type DialogVariant = 'default' | 'destructive' | 'warning' | 'success'

interface ConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel?: () => void
  variant?: DialogVariant
  isLoading?: boolean
  showIcon?: boolean
}

const variantStyles: Record<
  DialogVariant,
  {
    icon: typeof AlertTriangle
    iconClass: string
    actionClass: string
  }
> = {
  default: {
    icon: Info,
    iconClass: 'text-primary',
    actionClass: '',
  },
  destructive: {
    icon: XCircle,
    iconClass: 'text-destructive',
    actionClass: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  },
  warning: {
    icon: AlertTriangle,
    iconClass: 'text-yellow-500',
    actionClass: 'bg-yellow-500 text-white hover:bg-yellow-600',
  },
  success: {
    icon: CheckCircle,
    iconClass: 'text-green-500',
    actionClass: 'bg-green-500 text-white hover:bg-green-600',
  },
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'default',
  isLoading = false,
  showIcon = true,
}: ConfirmationDialogProps) {
  const { icon: Icon, iconClass, actionClass } = variantStyles[variant]

  const handleCancel = () => {
    onCancel?.()
    onOpenChange(false)
  }

  const handleConfirm = () => {
    onConfirm()
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {showIcon && <Icon className={cn('h-5 w-5', iconClass)} />}
            {title}
          </AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>

        {children && <div className="py-2">{children}</div>}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel} disabled={isLoading}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isLoading}
            className={actionClass}
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// Pre-configured confirmation dialogs for common scenarios

interface DeleteConfirmationProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemName?: string
  onConfirm: () => void
  isLoading?: boolean
}

export function DeleteConfirmation({
  open,
  onOpenChange,
  itemName = 'this item',
  onConfirm,
  isLoading,
}: DeleteConfirmationProps) {
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete Confirmation"
      description={`Are you sure you want to delete ${itemName}? This action cannot be undone.`}
      confirmLabel="Delete"
      onConfirm={onConfirm}
      variant="destructive"
      isLoading={isLoading}
    />
  )
}

interface BetConfirmationProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  stake: number
  asset: string
  priceRange?: string
  potentialPayout?: string
  onConfirm: () => void
  isLoading?: boolean
}

export function BetConfirmation({
  open,
  onOpenChange,
  stake,
  asset,
  priceRange,
  potentialPayout,
  onConfirm,
  isLoading,
}: BetConfirmationProps) {
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Confirm Prediction"
      description="Please review your prediction details before confirming."
      confirmLabel="Place Bet"
      onConfirm={onConfirm}
      variant="default"
      isLoading={isLoading}
      showIcon={false}
    >
      <div className="space-y-3 text-sm">
        <div className="flex justify-between py-2 border-b border-border/30">
          <span className="text-muted-foreground">Asset</span>
          <span className="font-mono font-semibold">{asset}</span>
        </div>
        <div className="flex justify-between py-2 border-b border-border/30">
          <span className="text-muted-foreground">Stake</span>
          <span className="font-mono font-semibold text-primary">
            ${stake.toFixed(2)} USDC
          </span>
        </div>
        {priceRange && (
          <div className="flex justify-between py-2 border-b border-border/30">
            <span className="text-muted-foreground">Price Range</span>
            <span className="font-mono">{priceRange}</span>
          </div>
        )}
        {potentialPayout && (
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Potential Payout</span>
            <span className="font-mono text-green-500">{potentialPayout}</span>
          </div>
        )}
        <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs text-yellow-600 dark:text-yellow-400">
          Bets are final and cannot be cancelled once placed.
        </div>
      </div>
    </ConfirmationDialog>
  )
}

interface WithdrawalConfirmationProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  amount: number
  address: string
  network: string
  onConfirm: () => void
  isLoading?: boolean
}

export function WithdrawalConfirmation({
  open,
  onOpenChange,
  amount,
  address,
  network,
  onConfirm,
  isLoading,
}: WithdrawalConfirmationProps) {
  const formatAddress = (addr: string) =>
    `${addr.slice(0, 10)}...${addr.slice(-8)}`

  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Confirm Withdrawal"
      description="Please verify the withdrawal details before confirming."
      confirmLabel="Withdraw"
      onConfirm={onConfirm}
      variant="warning"
      isLoading={isLoading}
    >
      <div className="space-y-3 text-sm font-mono">
        <div className="flex justify-between py-2 border-b border-border/30">
          <span className="text-muted-foreground">Amount</span>
          <span className="font-semibold text-green-500">
            ${amount.toFixed(2)} USDC
          </span>
        </div>
        <div className="flex justify-between py-2 border-b border-border/30">
          <span className="text-muted-foreground">To Address</span>
          <span className="text-foreground">{formatAddress(address)}</span>
        </div>
        <div className="flex justify-between py-2">
          <span className="text-muted-foreground">Network</span>
          <span className="text-foreground">{network}</span>
        </div>
      </div>
    </ConfirmationDialog>
  )
}

interface LogoutConfirmationProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function LogoutConfirmation({
  open,
  onOpenChange,
  onConfirm,
}: LogoutConfirmationProps) {
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Disconnect Wallet"
      description="Are you sure you want to disconnect your wallet? You will need to reconnect to continue trading."
      confirmLabel="Disconnect"
      onConfirm={onConfirm}
      variant="default"
    />
  )
}

export default ConfirmationDialog
