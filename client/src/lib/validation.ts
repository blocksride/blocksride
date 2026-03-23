import { z } from 'zod'

// Common validators
const ethereumAddress = z.string().regex(
  /^0x[a-fA-F0-9]{40}$/,
  'Invalid Ethereum address'
)

const positiveNumber = z.number().positive('Must be a positive number')

const uuidString = z.string().uuid('Invalid ID format')

// Bet/Position schemas
export const createPositionSchema = z.object({
  cell_id: uuidString,
  asset_id: z.string().min(1, 'Asset is required'),
  stake: positiveNumber.max(1000000, 'Stake exceeds maximum allowed'),
})

export type CreatePositionInput = z.infer<typeof createPositionSchema>

// Withdrawal schemas
export const withdrawalSchema = z.object({
  amount: positiveNumber
    .min(1, 'Minimum withdrawal is $1')
    .max(100000, 'Maximum withdrawal is $100,000'),
  address: ethereumAddress,
})

export type WithdrawalInput = z.infer<typeof withdrawalSchema>

// Profile schemas
export const profileUpdateSchema = z.object({
  nickname: z.string()
    .min(2, 'Nickname must be at least 2 characters')
    .max(30, 'Nickname must be 30 characters or less')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Nickname can only contain letters, numbers, underscores, and hyphens'
    ),
})

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>

// Grid/Trading schemas
export const gridQuerySchema = z.object({
  asset_id: z.string().default('ETH-USD'),
  timeframe: z.number().int().positive().default(60),
})

export type GridQueryInput = z.infer<typeof gridQuerySchema>

// Leaderboard query schemas
export const leaderboardQuerySchema = z.object({
  limit: z.number().int().min(1).max(100).default(10),
  timeframe: z.enum(['daily', 'weekly', 'monthly', 'all']).default('all'),
})

export type LeaderboardQueryInput = z.infer<typeof leaderboardQuerySchema>

// History filter schemas
export const historyFilterSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  outcome: z.enum(['won', 'lost', 'pending', 'all']).default('all'),
  contestId: z.string().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
})

export type HistoryFilterInput = z.infer<typeof historyFilterSchema>

// Price alert schemas (for future use)
export const priceAlertSchema = z.object({
  asset_id: z.string().min(1, 'Asset is required'),
  target_price: positiveNumber,
  direction: z.enum(['above', 'below']),
  notify_via: z.enum(['browser', 'email']).default('browser'),
})

export type PriceAlertInput = z.infer<typeof priceAlertSchema>

// Search schemas
export const searchQuerySchema = z.object({
  query: z.string().min(1, 'Search query is required').max(100),
})

export type SearchQueryInput = z.infer<typeof searchQuerySchema>

// Utility function to validate and parse data
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: z.ZodError } {
  const result = schema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, errors: result.error }
}

// Format Zod errors for display
export function formatZodErrors(errors: z.ZodError): Record<string, string> {
  const formatted: Record<string, string> = {}
  errors.issues.forEach((issue) => {
    const path = issue.path.join('.')
    if (!formatted[path]) {
      formatted[path] = issue.message
    }
  })
  return formatted
}

// Get first error message from Zod errors
export function getFirstError(errors: z.ZodError): string {
  return errors.issues[0]?.message ?? 'Validation failed'
}
