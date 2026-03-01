export interface PricePoint {
    time: number
    price: number
}

export interface Grid {
    grid_id: string
    asset_id: string
    timeframe_sec: number
    price_interval: number
    anchor_price: number
    start_time: string
    end_time: string
    bet_lock_seconds?: number // Seconds before window start when betting closes (default: 5)
}

export interface Cell {
    cell_id: string
    grid_id: string
    asset_id: string
    window_index: number
    price_band_index: number
    t_start: string
    t_end: string
    p_low: number
    p_high: number
    result?: string
    total_stake?: number
    // Share-based pricing fields
    probability?: number
    total_shares?: number
    max_shares?: number
}

export enum PositionState {
    PENDING = 'PENDING',
    ACTIVE = 'ACTIVE',
    LOCKED = 'LOCKED',
    RESOLVED = 'RESOLVED',
    VOIDED = 'VOIDED',
}

export interface Position {
    position_id: string
    user_id: string
    asset_id: string
    cell_id: string
    stake: number
    state: PositionState | 'PENDING' | 'ACTIVE' | 'LOCKED' | 'RESOLVED' | 'VOIDED'
    is_practice: boolean
    created_at?: string
    payout?: number
    result?: string
    resolved_at?: string
    // Share-based pricing fields
    shares_bought?: number
    purchase_price?: number
    potential_payout?: number
}

// Share-based pricing types
export interface BetQuote {
    cell_id: string
    stake: number
    probability: number
    share_price: number
    shares_bought: number
    potential_payout: number
    expected_value: number
    available_shares: number
    can_purchase: boolean
}

export interface CellPrice {
    cell_id: string
    probability: number
    share_price: number
    total_shares: number
    max_shares: number
    available_shares: number
}
