'use client'

import { useEffect, useRef } from 'react'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

/** Resolução interna do canvas = foto × este fator, para pontos nítidos. */
const CANVAS_SCALE = 2

interface LandmarkOverlayProps {
  landmarks: NormalizedLandmark[]
  /** Dimensões da imagem de trabalho (define a resolução do canvas). */
  width: number
  height: number
  showIndices: boolean
  /** Retângulo CSS (letterbox) onde a foto está desenhada, em px. */
  rect: { left: number; top: number; width: number; height: number }
}

export default function LandmarkOverlay({
  landmarks,
  width,
  height,
  showIndices,
  rect,
}: LandmarkOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const w = width * CANVAS_SCALE
    const h = height * CANVAS_SCALE
    canvas.width = w
    canvas.height = h
    context.clearRect(0, 0, w, h)

    context.font = `${7 * CANVAS_SCALE}px ui-monospace, monospace`
    context.textAlign = 'left'
    context.textBaseline = 'bottom'

    for (let i = 0; i < landmarks.length; i++) {
      const x = landmarks[i].x * w
      const y = landmarks[i].y * h

      context.beginPath()
      context.arc(x, y, 2 * CANVAS_SCALE, 0, Math.PI * 2)
      context.fillStyle = '#2dd4bf'
      context.fill()
      context.lineWidth = CANVAS_SCALE * 0.75
      context.strokeStyle = 'rgba(0, 0, 0, 0.8)'
      context.stroke()

      if (showIndices) {
        const label = String(i)
        const lx = x + 3 * CANVAS_SCALE
        const ly = y - 2 * CANVAS_SCALE
        context.lineWidth = 2.5 * CANVAS_SCALE
        context.strokeStyle = 'rgba(0, 0, 0, 0.85)'
        context.strokeText(label, lx, ly)
        context.fillStyle = '#ffffff'
        context.fillText(label, lx, ly)
      }
    }
  }, [landmarks, width, height, showIndices])

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
