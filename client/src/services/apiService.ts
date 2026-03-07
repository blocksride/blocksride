import axiosInstance from '../utility/axiosInterceptor'
import { Grid, Cell, Position, BetQuote, CellPrice } from '../types/grid'

export const api = {
    health: () => axiosInstance.get(`/health`),

    // Trading pairs
    getTradingPairs: () => axiosInstance.get<TradingPair[]>(`/trading-pairs`),

    generateGrid: (assetId: string = 'ETH-USD', timeframe: number = 60) =>
        axiosInstance.post<Grid>(
            `/grids/ensure?asset_id=${assetId}&timeframe=${timeframe}`
        ),

    getActiveGrids: (assetId: string = 'ETH-USD', timeframe: number = 60) =>
        axiosInstance.get<Grid[]>(
            `/grids/active?asset_id=${assetId}&timeframe=${timeframe}`
        ),

    getCells: (gridId: string) =>
        axiosInstance.get<Cell[]>(`/grids/${gridId}/cells`),

    getPriceHistory: (assetId: string, startTime?: string, endTime?: string) => {
        const params = new URLSearchParams()
        if (startTime) params.append('start', startTime)
        if (endTime) params.append('end', endTime)
        return axiosInstance.get<
            {
                asset_id: string
                timestamp: string
                price: number
                source: string
                weight: number
            }[]
        >(`/prices/${assetId}?${params.toString()}`)
    },

    getPublicPrice: (assetId: string = 'ETH-USD') =>
        axiosInstance.get<PublicPrice>(`/public-price?asset_id=${assetId}`),

    createPosition: (cellId: string, assetId: string, stake: number, isPractice: boolean = false) =>
        axiosInstance.post<Position>(`/positions`, {
            cell_id: cellId,
            asset_id: assetId,
            stake,
            is_practice: isPractice,
        }),

    getPositions: (isPractice?: boolean) => {
        const params = isPractice !== undefined ? `?is_practice=${isPractice}` : ''
        return axiosInstance.get<Position[]>(`/positions${params}`)
    },

    updatePosition: (positionId: string, state: string, payout?: number) =>
        axiosInstance.patch(`/positions/${positionId}`, { state, payout }),

    withdraw: (amount: number, address: string) =>
        axiosInstance.post(`/users/withdraw`, { amount, address }),

    getWithdrawals: (limit: number = 20, offset: number = 0) =>
        axiosInstance.get<WithdrawalRequest[]>(`/users/withdrawals?limit=${limit}&offset=${offset}`),

    getWithdrawalByID: (id: string) =>
        axiosInstance.get<WithdrawalRequest>(`/users/withdrawals/${id}`),

    getUserStats: () => axiosInstance.get('/user/stats'),

    getLeaderboard: (limit: number = 10) =>
        axiosInstance.get(`/leaderboard?limit=${limit}`),

    // Contest APIs
    getActiveContest: () =>
        axiosInstance.get<{ active: boolean; contest: Contest | null }>('/contests/active'),

    getUpcomingContests: () =>
        axiosInstance.get<{ contests: Contest[] }>('/contests/upcoming'),

    getContest: (contestId: string) =>
        axiosInstance.get<Contest>(`/contests/${contestId}`),

    getContestGrid: (contestId: string) =>
        axiosInstance.get<{ contest: Contest; grid: Grid; cells: Cell[] }>(
            `/contests/${contestId}/grid`
        ),

    getContestLeaderboard: (contestId: string, limit: number = 20) =>
        axiosInstance.get<{ contest_id: string; entries: LeaderboardEntry[] }>(
            `/contests/${contestId}/leaderboard?limit=${limit}`
        ),

    // Share-based pricing endpoints
    getCellPrices: (gridId: string) =>
        axiosInstance.get<CellPrice[]>(`/grids/${gridId}/prices`),

    getBetQuote: (cellId: string, assetId: string, stake: number) =>
        axiosInstance.post<BetQuote>(`/positions/quote`, {
            cell_id: cellId,
            asset_id: assetId,
            stake,
        }),

    logMiniAppContext: (payload: MiniAppContextPayload) =>
        axiosInstance.post(`/analytics/miniapp`, payload),
}

export interface LeaderboardEntry {
    user_id: string
    wallet_address: string
    total_volume: number
    net_pnl: number
    rank: number
}

export interface Contest {
    contest_id: string
    name: string
    description: string
    asset_id: string
    grid_id: string | null
    start_time: string
    end_time: string
    status: 'draft' | 'upcoming' | 'active' | 'completed' | 'cancelled'
    price_interval: number
    timeframe_sec: number
    bands_above: number
    bands_below: number
    frozen_windows: number
    created_at: string
    updated_at: string
}

export interface TradingPair {
    asset_id: string
    symbol: string
    quote: string
    price_source: string
    tick_size: number
    timeframe_sec?: number
    price_interval?: number
    num_windows?: number
    bands_above?: number
    bands_below?: number
    status: string
    created_at: string
    updated_at: string
}

export interface PublicPrice {
    asset_id: string
    price: number
    source: string
    ts: string
    stale?: boolean
}

export type WithdrawalStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'queued'

export interface WithdrawalRequest {
    id: string
    user_id: string
    amount: number
    to_address: string
    status: WithdrawalStatus
    tx_hash?: string
    error_message?: string
    created_at: string
    processed_at?: string
    completed_at?: string
}

export interface MiniAppContextPayload {
    context: unknown
    user_agent: string
    url: string
}
