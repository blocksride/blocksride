import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface BottomDrawerProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  defaultHeight?: 'half' | 'full'
  snapPoints?: [number, number, number] // [collapsed, half, full] in vh
  header?: React.ReactNode
  children: React.ReactNode
  backdrop?: boolean
}

export const BottomDrawer: React.FC<BottomDrawerProps> = ({
  isOpen,
  onOpenChange,
  defaultHeight = 'half',
  snapPoints = [8, 50, 90],
  header,
  children,
  backdrop = true,
}) => {
  const [height, setHeight] = useState(snapPoints[defaultHeight === 'half' ? 1 : 2])
  const [isDragging, setIsDragging] = useState(false)
  const [startY, setStartY] = useState(0)
  const [startHeight, setStartHeight] = useState(0)

  const drawerRef = useRef<HTMLDivElement>(null)
  const dragHandleRef = useRef<HTMLDivElement>(null)

  // Handle touch start on drag handle
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    setIsDragging(true)
    setStartY(touch.clientY)
    setStartHeight(height)
  }

  // Handle touch move
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return

    const touch = e.touches[0]
    const deltaY = startY - touch.clientY
    const viewportHeight = window.innerHeight
    const deltaVh = (deltaY / viewportHeight) * 100

    const newHeight = Math.max(snapPoints[0], Math.min(snapPoints[2], startHeight + deltaVh))
    setHeight(newHeight)
  }

  // Handle touch end - snap to nearest point
  const handleTouchEnd = () => {
    setIsDragging(false)

    // Find nearest snap point
    const nearest = snapPoints.reduce((prev, curr) =>
      Math.abs(curr - height) < Math.abs(prev - height) ? curr : prev
    )

    setHeight(nearest)

    // If snapped to collapsed, close drawer
    if (nearest === snapPoints[0]) {
      onOpenChange(false)
    }
  }

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // Focus management
  useEffect(() => {
    if (isOpen && drawerRef.current) {
      const firstFocusable = drawerRef.current.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      firstFocusable?.focus()
    }
  }, [isOpen])

  if (!isOpen) return null

  const drawer = (
    <>
      {/* Backdrop */}
      {backdrop && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-drawer"
          onClick={() => onOpenChange(false)}
          style={{
            opacity: (height - snapPoints[0]) / (snapPoints[2] - snapPoints[0]),
            transition: isDragging ? 'none' : 'opacity 0.3s ease-out',
          }}
        />
      )}

      {/* Drawer */}
      <div
        ref={drawerRef}
        className="fixed left-0 right-0 bg-background border-t border-border rounded-t-2xl z-drawer shadow-2xl"
        style={{
          bottom: 0,
          height: `${height}vh`,
          transition: isDragging ? 'none' : 'height 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
          touchAction: 'none',
        }}
        role="dialog"
        aria-modal="true"
      >
        {/* Drag handle */}
        <div
          ref={dragHandleRef}
          className="flex items-center justify-center py-3 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {header || <div className="w-12 h-1.5 bg-border rounded-full" />}
        </div>

        {/* Content */}
        <div className="overflow-y-auto h-[calc(100%-60px)] overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          {children}
        </div>
      </div>
    </>
  )

  // Render in portal for proper stacking
  return createPortal(drawer, document.body)
}
