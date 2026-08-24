'use client'

import { useEffect, useRef } from 'react'
import { smoothClassAlpha, type LabelMap } from '@/lib/segmentation/mask'

/** Raio da suavização de borda, em pixels do labelmap. */
const EDGE_BLUR_RADIUS = 3

interface MaskOverlayProps {
  map: LabelMap
  /** Ids de classe destacados. */
  classIds: readonly number[]
  /** Retângulo CSS (letterbox) onde a foto está desenhada, em px. */
  rect: { left: number; top: number; width: number; height: number }
}

export default function MaskOverlay({ map, classIds, rect }: MaskOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    canvas.width = map.width
    canvas.height = map.height

    const alpha = smoothClassAlpha(map, classIds, EDGE_BLUR_RADIUS)
    const pixels = context.createImageData(map.width, map.height)
    for (let i = 0; i < alpha.length; i++) {
      const offset = i * 4
      pixels.data[offset] = 45 // teal-400
      pixels.data[offset + 1] = 212
      pixels.data[offset + 2] = 191
      pixels.data[offset + 3] = (alpha[i] * 0.55) | 0
    }
    context.putImageData(pixels, 0, 0)
  }, [map, classIds])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
    />
  )
}
