import { useEffect, useRef, useState } from 'react'
import type { PricePoint } from '../types/grid'

type AssetConfig = {
    coinId: string
    symbol: string
    defaultPrice: number
    volatility: number
}

const ASSET_CONFIG: Record<string, AssetConfig> = {
    'ETH-USD': {
        coinId: 'ethereum',
        symbol: 'ETH',
        defaultPrice: 3000,
        volatility: 2.5,
    },
    'BTC-USD': {
        coinId: 'bitcoin',
        symbol: 'BTC',
        defaultPrice: 50000,
        volatility: 18,
    },
}

const getAssetConfig = (assetId: string) => {
    return ASSET_CONFIG[assetId] || ASSET_CONFIG['ETH-USD']
}

const fetchCoingeckoPrice = async (coinId: string) => {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const price = data?.[coinId]?.usd
    return typeof price === 'number' ? price : null
}

const fetchCoinbasePrice = async (symbol: string) => {
    const url = `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const price = data?.data?.amount
    const parsed = price ? Number(price) : NaN
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
            const coingeckoPrice = await fetchCoingeckoPrice(config.coinId)
            if (!mountedRef.current) return

            if (coingeckoPrice !== null) {
                targetPriceRef.current = coingeckoPrice
                return
            }

            const coinbasePrice = await fetchCoinbasePrice(config.symbol)
            if (!mountedRef.current) return

            if (coinbasePrice !== null) {
                targetPriceRef.current = coinbasePrice
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
                const drift = (target - base) * 0.2
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
                } else if (now - lastPointRef.current > 1000) {
                    setPrices((prevPrices) => {
                        const updated = [...prevPrices, { time: now, price: next }]
                        return updated.length > 5000 ? updated.slice(-5000) : updated
                    })
                    lastPointRef.current = now
                }

                return next
            })
        }

        updateTarget()
        const pollId = window.setInterval(updateTarget, 12000)
        const tickId = window.setInterval(tick, 500)

        return () => {
            mountedRef.current = false
            window.clearInterval(pollId)
            window.clearInterval(tickId)
        }
    }, [assetId, config.coinId, config.defaultPrice, config.symbol, config.volatility])

    return { prices, currentPrice }
}
