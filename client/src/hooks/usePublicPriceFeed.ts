import { useEffect, useRef, useState } from 'react'
import type { PricePoint } from '@/types/grid'

type AssetConfig = {
    defaultPrice: number
    volatility: number
}

const ASSET_CONFIG: Record<string, AssetConfig> = {
    'ETH-USD': { defaultPrice: 3000, volatility: 2.5 },
    'BTC-USD': { defaultPrice: 50000, volatility: 18 },
}

const getAssetConfig = (assetId: string) => ASSET_CONFIG[assetId] || ASSET_CONFIG['ETH-USD']

export const usePublicPriceFeed = (assetId: string) => {
    const config = getAssetConfig(assetId)
    const [prices, setPrices] = useState<PricePoint[]>([])
    const [currentPrice, setCurrentPrice] = useState<number | null>(null)
    const targetPriceRef = useRef<number | null>(null)
    const lastPointRef = useRef<number>(0)
    const seededRef = useRef(false)
    const mountedRef = useRef(true)

    useEffect(() => {
        mountedRef.current = true
        setPrices([])
        setCurrentPrice(null)
        targetPriceRef.current = null
        lastPointRef.current = 0
        seededRef.current = false

        const updateTarget = async () => {
            try {
                const { data } = await api.getPublicPrice(assetId)
                if (!mountedRef.current) return
                if (typeof data.price === 'number' && Number.isFinite(data.price)) {
                    targetPriceRef.current = data.price
                    return
                }
            } catch {
                // keep last cached target
            }

            if (targetPriceRef.current === null) {
                targetPriceRef.current = config.defaultPrice
            }
        }

        const tick = () => {
            if (!mountedRef.current) return
            const target = targetPriceRef.current ?? config.defaultPrice

            setCurrentPrice((prev) => {
                const base = prev ?? target
                const drift = (target - base) * 0.25
                const noise = (Math.random() - 0.5) * config.volatility
                const next = Math.max(0, base + drift + noise)
                const now = Date.now()

                if (!seededRef.current) {
                    seededRef.current = true
                    const initialPoints: PricePoint[] = []
                    for (let i = 60; i > 0; i -= 1) {
                        initialPoints.push({
                            time: now - i * 1000,
                            price: next + (Math.random() - 0.5) * config.volatility * 2,
                        })
                    }
                    setPrices(initialPoints)
                    lastPointRef.current = now
                } else if (now - lastPointRef.current >= 1000) {
                    setPrices((prevPrices) => {
                        const updated = [...prevPrices, { time: now, price: next }]
                        return updated.length > 5000 ? updated.slice(-5000) : updated
                    })
                    lastPointRef.current = now
                }

                return next
            })
        }

        void updateTarget()
        const pollId = window.setInterval(updateTarget, 5000)
        const tickId = window.setInterval(tick, 500)

        return () => {
            mountedRef.current = false
            window.clearInterval(pollId)
            window.clearInterval(tickId)
        }
    }, [assetId, config.defaultPrice, config.volatility])

    return { prices, currentPrice }
}
