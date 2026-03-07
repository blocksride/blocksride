import { useEffect, useRef, useState } from 'react'
import { api } from '@/services/apiService'
import type { PricePoint } from '@/types/grid'

type AssetConfig = {
    defaultPrice: number
    volatility: number
}

const ASSET_CONFIG: Record<string, AssetConfig> = {
    'ETH-USD': {
        defaultPrice: 3000,
        volatility: 2.5,
    },
    'BTC-USD': {
        defaultPrice: 50000,
        volatility: 18,
    },
}

const getAssetConfig = (assetId: string) => {
    return ASSET_CONFIG[assetId] || ASSET_CONFIG['ETH-USD']
}

const fetchPublicPrice = async (assetId: string) => {
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:8080'
    const baseURL = serverUrl.endsWith('/api') ? serverUrl : `${serverUrl}/api`
    const url = `${baseURL}/public-price?asset_id=${encodeURIComponent(assetId)}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const parsed = Number(data?.price)
    return Number.isFinite(parsed) ? parsed : null
}

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
            const publicPrice = await fetchPublicPrice(assetId)
            if (!mountedRef.current) return

            if (publicPrice !== null) {
                targetPriceRef.current = publicPrice
                return
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
