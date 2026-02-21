import React from 'react'
import { Skeleton } from '@/components/ui/skeleton'

export const GridSkeleton: React.FC = () => {
    return (
        <div className="absolute inset-0 flex flex-col p-4 gap-4">
            {/* Price axis skeleton */}
            <div className="flex justify-between items-center">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-24" />
            </div>

            {/* Grid skeleton */}
            <div className="flex-1 flex flex-col gap-2">
                {/* Grid rows */}
                {[...Array(8)].map((_, rowIdx) => (
                    <div key={rowIdx} className="flex-1 flex gap-2">
                        {/* Price label */}
                        <Skeleton className="w-16 h-full" />

                        {/* Grid cells */}
                        <div className="flex-1 flex gap-1">
                            {[...Array(12)].map((_, colIdx) => (
                                <Skeleton
                                    key={colIdx}
                                    className="flex-1 h-full opacity-50"
                                    style={{
                                        animationDelay: `${(rowIdx * 12 + colIdx) * 20}ms`
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Time axis skeleton */}
            <div className="flex justify-between px-16">
                {[...Array(6)].map((_, i) => (
                    <Skeleton key={i} className="h-3 w-12" />
                ))}
            </div>

            {/* Loading indicator */}
            <div className="absolute inset-0 flex items-center justify-center bg-background/30 backdrop-blur-[1px]">
                <div className="flex flex-col items-center gap-3 p-6 rounded-xl bg-card/80 border border-border shadow-lg">
                    <div className="relative">
                        <div className="w-10 h-10 border-2 border-primary/20 rounded-full" />
                        <div className="absolute top-0 w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                    <span className="text-sm font-medium text-foreground">Loading Market Data</span>
                    <span className="text-xs text-muted-foreground">Connecting to price feed...</span>
                </div>
            </div>
        </div>
    )
}
