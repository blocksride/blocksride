import React, { useEffect, useState } from 'react'

interface Particle {
    id: number
    x: number
    y: number
    color: string
    delay: number
    duration: number
}

interface ConfettiProps {
    show: boolean
    onComplete?: () => void
}

const COLORS = [
    '#00cc66', // Green
    '#3b82f6', // Blue
    '#f59e0b', // Amber
    '#ec4899', // Pink
    '#8b5cf6', // Purple
    '#06b6d4', // Cyan
]

export const Confetti: React.FC<ConfettiProps> = ({ show, onComplete }) => {
    const [particles, setParticles] = useState<Particle[]>([])

    useEffect(() => {
        if (show) {
            // Create particles
            const newParticles: Particle[] = []
            for (let i = 0; i < 50; i++) {
                newParticles.push({
                    id: i,
                    x: Math.random() * 100,
                    y: -10 - Math.random() * 20,
                    color: COLORS[Math.floor(Math.random() * COLORS.length)],
                    delay: Math.random() * 0.5,
                    duration: 1.5 + Math.random() * 1,
                })
            }
            setParticles(newParticles)

            // Cleanup after animation
            const timer = setTimeout(() => {
                setParticles([])
                onComplete?.()
            }, 3000)

            return () => clearTimeout(timer)
        }
    }, [show, onComplete])

    if (particles.length === 0) return null

    return (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
            {particles.map((particle) => (
                <div
                    key={particle.id}
                    className="absolute rounded-sm"
                    style={{
                        left: `${particle.x}%`,
                        top: `${particle.y}%`,
                        width: '8px',
                        height: '8px',
                        backgroundColor: particle.color,
                        animation: `confettiFall ${particle.duration}s ease-out ${particle.delay}s forwards`,
                        transform: `rotate(${Math.random() * 360}deg)`,
                    }}
                />
            ))}
        </div>
    )
}

// Hook for triggering confetti
// eslint-disable-next-line react-refresh/only-export-components
export function useConfetti() {
    const [showConfetti, setShowConfetti] = useState(false)

    const trigger = () => {
        setShowConfetti(true)
    }

    const reset = () => {
        setShowConfetti(false)
    }

    return { showConfetti, trigger, reset }
}
