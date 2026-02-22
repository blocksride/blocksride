import React, { useState } from 'react'

const CHIP_AMOUNTS = [1, 5, 10, 25] as const
const CHIP_STORAGE_KEY = 'blocksride_active_chip'

interface ChipBarProps {
    value: number
    onChange: (amount: number) => void
    balance: number
    onAddFunds?: () => void
}

/**
 * Horizontal stake chip selector.
 * Preset chips: $1 $5 $10 $25, plus a custom-amount input (···).
 * Active chip highlights with amber glow; selection persists to localStorage.
 */
export const ChipBar: React.FC<ChipBarProps> = ({ value, onChange, balance, onAddFunds }) => {
    const [customOpen, setCustomOpen] = useState(false)
    const [customInput, setCustomInput] = useState('')

    const isPreset = (CHIP_AMOUNTS as readonly number[]).includes(value)
    const isOutOfFunds = balance <= 0

    const handleAddFunds = () => {
        if (onAddFunds) {
            onAddFunds()
            return
        }
        if (isOutOfFunds && typeof document !== 'undefined') {
            const trigger = document.querySelector('[data-wallet-trigger]') as HTMLButtonElement | null
            trigger?.click()
        }
    }

    const handleChipClick = (amount: number) => {
        setCustomOpen(false)
        onChange(amount)
        localStorage.setItem(CHIP_STORAGE_KEY, String(amount))
    }

    const handleCustomCommit = () => {
        const parsed = parseFloat(customInput)
        if (!isNaN(parsed) && parsed > 0) {
            onChange(parsed)
            localStorage.setItem(CHIP_STORAGE_KEY, String(parsed))
        }
        setCustomOpen(false)
        setCustomInput('')
    }

    const handleCustomKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') handleCustomCommit()
        if (e.key === 'Escape') {
            setCustomOpen(false)
            setCustomInput('')
        }
    }

    if (isOutOfFunds) {
        return (
            <div className="flex items-center gap-2">
                <button
                    onClick={handleAddFunds}
                    className={[
                        'flex-1 h-9 rounded-md text-xs font-mono font-semibold transition-all duration-150 select-none',
                        'border border-primary bg-primary text-primary-foreground hover:bg-primary/90',
                        'focus:outline-none focus-visible:ring-1 focus-visible:ring-primary',
                    ].join(' ')}
                >
                    Add Funds
                </button>
                <span className="text-[10px] text-muted-foreground font-mono">
                    Balance $0.00
                </span>
            </div>
        )
    }

    return (
        <div className="flex items-center gap-1.5">
            {CHIP_AMOUNTS.map((amount) => {
                const active = value === amount && isPreset && !customOpen
                const disabled = amount > balance
                return (
                    <button
                        key={amount}
                        onClick={() => !disabled && handleChipClick(amount)}
                        disabled={disabled}
                        aria-pressed={active}
                        aria-label={`Stake $${amount}`}
                        className={[
                            'flex-1 h-9 rounded-md text-xs font-mono font-semibold transition-all duration-150 select-none',
                            'border focus:outline-none focus-visible:ring-1 focus-visible:ring-primary',
                            active
                                ? 'bg-primary text-primary-foreground border-primary shadow-[0_0_12px_hsl(var(--primary)/0.45)] scale-[1.05]'
                                : disabled
                                    ? 'bg-secondary/20 text-muted-foreground/30 border-border/20 cursor-not-allowed'
                                    : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary border-border/50 hover:border-border active:scale-95',
                        ].join(' ')}
                    >
                        ${amount}
                    </button>
                )
            })}

            {/* Custom amount */}
            {customOpen ? (
                <input
                    autoFocus
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    onBlur={handleCustomCommit}
                    onKeyDown={handleCustomKeyDown}
                    placeholder="0.00"
                    className="w-16 h-9 rounded-md text-xs font-mono font-semibold bg-secondary border border-primary text-foreground px-2 focus:outline-none focus:ring-1 focus:ring-primary"
                    aria-label="Custom stake amount"
                />
            ) : (
                <button
                    onClick={() => setCustomOpen(true)}
                    aria-label="Enter custom stake amount"
                    className={[
                        'w-10 h-9 rounded-md text-sm font-mono font-bold transition-all duration-150 select-none',
                        'border focus:outline-none focus-visible:ring-1 focus-visible:ring-primary',
                        !isPreset && !customOpen
                            ? 'bg-primary text-primary-foreground border-primary shadow-[0_0_12px_hsl(var(--primary)/0.45)] scale-[1.05]'
                            : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary border-border/50 hover:border-border active:scale-95',
                    ].join(' ')}
                >
                    ···
                </button>
            )}
        </div>
    )
}
