import React from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TradeControls } from '@/components/grid/TradeControls'
import { PositionSummary } from '@/components/grid/PositionSummary'
import { BetHistory } from '@/components/grid/BetHistory'
import { Cell, Position, BetQuote } from '@/types/grid'
import { DollarSign, TrendingUp, History } from 'lucide-react'

interface MobileControlTabsProps {
  currentStake: number
  onStakeChange: (amount: number) => void
  balance: number
  isPractice: boolean
  positions: Position[]
  selectedCells: string[]
  betResults: Record<string, 'won' | 'lost' | 'pending' | 'winning'>
  cells: Cell[]
  betQuote?: BetQuote | null
  quoteLoading?: boolean
  selectedCellId?: string | null
}

export const MobileControlTabs: React.FC<MobileControlTabsProps> = ({
  currentStake,
  onStakeChange,
  balance,
  isPractice,
  positions,
  selectedCells,
  betResults,
  cells,
  betQuote,
  quoteLoading,
  selectedCellId,
}) => {
  const activePositionsCount = positions.filter(p => selectedCells.includes(p.cell_id)).length
  const completedBetsCount = Object.keys(betResults).filter(
    cellId => betResults[cellId] === 'won' || betResults[cellId] === 'lost'
  ).length

  return (
    <Tabs defaultValue="trade" className="w-full">
      <TabsList className="grid w-full grid-cols-3 sticky top-0 z-10 bg-background">
        <TabsTrigger value="trade" className="gap-1.5">
          <DollarSign className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Trade</span>
        </TabsTrigger>
        <TabsTrigger value="positions" className="gap-1.5">
          <TrendingUp className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Positions</span>
          {activePositionsCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-primary text-primary-foreground">
              {activePositionsCount}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="history" className="gap-1.5">
          <History className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">History</span>
          {completedBetsCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-secondary text-secondary-foreground">
              {completedBetsCount}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="trade" className="mt-0">
        <TradeControls
          stake={currentStake}
          onStakeChange={onStakeChange}
          balance={balance}
          isPractice={isPractice}
          betQuote={betQuote}
          quoteLoading={quoteLoading}
          selectedCellId={selectedCellId}
        />
      </TabsContent>

      <TabsContent value="positions" className="mt-0">
        <PositionSummary
          selectedCells={selectedCells}
          betResults={betResults}
          positions={positions}
        />
      </TabsContent>

      <TabsContent value="history" className="mt-0">
        <BetHistory
          betResults={betResults}
          cells={cells}
          positions={positions}
        />
      </TabsContent>
    </Tabs>
  )
}
