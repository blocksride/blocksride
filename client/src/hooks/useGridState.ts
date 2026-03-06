import { useState, useEffect } from 'react'
import { api } from '../services/apiService'
import type { Grid, Cell } from '../types/grid'

export function useGridState(selectedAsset: string, selectedTimeframe: number) {
    const [grid, setGrid] = useState<Grid | null>(null)
    const [cells, setCells] = useState<Cell[]>([])
    useEffect(() => {
        let isMounted = true

        const fetchActiveGrid = async () => {
            try {
                const { data: grids } = await api.getActiveGrids(
                    selectedAsset,
                    selectedTimeframe
                )
                if (!isMounted) return

                if (grids && grids.length > 0) {
                    setGrid(grids[0])
                    const { data: cellsData } = await api.getCells(grids[0].grid_id)
                    if (isMounted) {
                        setCells(cellsData)
                        // Dispatch event to signal cells are ready for position loading
                        window.dispatchEvent(new CustomEvent('cells_refreshed'))
                    }
                } else {
                    await api.generateGrid(selectedAsset, selectedTimeframe)
                    if (!isMounted) return

                    const { data: grids } = await api.getActiveGrids(
                        selectedAsset,
                        selectedTimeframe
                    )
                    if (!isMounted) return

                    if (grids && grids.length > 0) {
                        setGrid(grids[0])
                        const { data: cellsData } = await api.getCells(grids[0].grid_id)
                        if (isMounted) {
                            setCells(cellsData)
                            // Dispatch event to signal cells are ready for position loading
                            window.dispatchEvent(new CustomEvent('cells_refreshed'))
                        }
                    }
                }
            } catch (error) {
                console.error('[useGridState] Failed to fetch grid:', error)
            }
        }

        setGrid(null)
        setCells([])
        fetchActiveGrid()

        return () => {
            isMounted = false
        }
    }, [selectedAsset, selectedTimeframe])

    useEffect(() => {
        if (!grid) return

        let isMounted = true

        const refreshCells = async (dispatchReady = false) => {
            try {
                const { data: cellsData } = await api.getCells(grid.grid_id)
                if (!isMounted) return
                setCells(cellsData)
                // Dispatch event to signal cells are ready for position loading
                if (dispatchReady) {
                    window.dispatchEvent(new CustomEvent('cells_refreshed'))
                }
            } catch (error) {
                console.error('[useGridState] Failed to refresh cells:', error)
            }
        }

        const handleCellResolved = () => refreshCells(false)
        // When position is updated, refresh cells first, then signal positions can load
        const handlePositionUpdated = () => refreshCells(true)

        // Listen for cell resolution events from WebSocket
        window.addEventListener('cell_resolved', handleCellResolved)
        // Also refresh cells when a position is placed (may create new cells)
        window.addEventListener('position_updated', handlePositionUpdated)

        return () => {
            isMounted = false
            window.removeEventListener('cell_resolved', handleCellResolved)
            window.removeEventListener('position_updated', handlePositionUpdated)
        }
    }, [grid])

    return { grid, cells }
}
