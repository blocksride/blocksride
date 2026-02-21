import { useState, useEffect } from 'react'

export function useScaleKey(selectedAsset: string) {
  const [scaleKey, setScaleKey] = useState(0)
  useEffect(() => {
    setScaleKey((prev) => prev + 1)
  }, [selectedAsset])
  return scaleKey
}
