'use client'

import { useEffect, useRef } from 'react'
import {
  centroid,
  interocularDistance,
  REGION_ANCHORS,
  PHILTRUM_POLYGON,
  type RegionId,
} from '@/lib/anatomy'
import { FACE_CLASSES, smoothClassAlpha, type LabelMap } from '@/lib/segmentation/mask'
import type { Point2 } from '@/lib/quality'

/** Regiões cuja forma vem direto da máscara de segmentação. */
const MASK_BACKED: Partial<Record<RegionId, number[]>> = {
  'labio-superior': [FACE_CLASSES.u_lip],
  'labio-inferior': [FACE_CLASSES.l_lip],
  'orbital-direita': [FACE_CLASSES.l_eye, FACE_CLASSES.l_brow],
  'orbital-esquerda': [FACE_CLASSES.r_eye, FACE_CLASSES.r_brow],
}

/** Raios da elipse suave (em múltiplos da distância interocular). */
const ANCHOR_SHAPES: Partial<Record<RegionId, { rx: number; ry: number }>> = {
  'malar-direito': { rx: 0.45, ry: 0.35 },
  'malar-esquerdo': { rx: 0.45, ry: 0.35 },
  'sulco-nasogeniano-direito': { rx: 0.22, ry: 0.35 },
  'sulco-nasogeniano-esquerdo': { rx: 0.22, ry: 0.35 },
  mento: { rx: 0.4, ry: 0.32 },
}

const HIGHLIGHT_RGB = '45, 212, 191' // teal-400
const EDGE_BLUR_RADIUS = 3

interface RegionHighlightProps {
  region: RegionId
  map: LabelMap
  landmarks: readonly Point2[]
  rect: { left: number; top: number; width: number; height: number }
}

/**
 * Destaque suave da região ativa: alpha da máscara (quando a região tem
 * classe própria) ou gradiente radial na âncora (regiões difusas).
 */
export default function RegionHighlight({
  region,
  map,
  landmarks,
  rect,
}: RegionHighlightProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const { width, height } = map
    canvas.width = width
    canvas.height = height
    context.clearRect(0, 0, width, height)

    const maskClasses = MASK_BACKED[region]
    if (maskClasses !== undefined) {
      const alpha = smoothClassAlpha(map, maskClasses, EDGE_BLUR_RADIUS)
      const pixels = context.createImageData(width, height)
      for (let i = 0; i < alpha.length; i++) {
        const offset = i * 4
        pixels.data[offset] = 45
        pixels.data[offset + 1] = 212
        pixels.data[offset + 2] = 191
        pixels.data[offset + 3] = (alpha[i] * 0.6) | 0
      }
      context.putImageData(pixels, 0, 0)
      return
    }

    const scale = interocularDistance(landmarks)

    if (region === 'filtro') {
      // O filtro tem contorno: polígono preenchido com leve desfoque.
      const polygon = PHILTRUM_POLYGON.map((index) => landmarks[index])
      context.save()
      context.filter = `blur(${Math.max(2, scale * width * 0.05)}px)`
      context.fillStyle = `rgba(${HIGHLIGHT_RGB}, 0.55)`
      context.beginPath()
      context.moveTo(polygon[0].x * width, polygon[0].y * height)
      for (let i = 1; i < polygon.length; i++) {
        context.lineTo(polygon[i].x * width, polygon[i].y * height)
      }
      context.closePath()
      context.fill()
      context.restore()
      return
    }

    const anchor = REGION_ANCHORS.find((a) => a.id === region)
    const shape = ANCHOR_SHAPES[region]
    if (anchor === undefined || shape === undefined) return
    const center = centroid(landmarks, anchor.indices)
    const cx = center.x * width
    const cy = center.y * height
    const rx = shape.rx * scale * width
    const ry = shape.ry * scale * height

    // Gradiente radial: centro forte, borda que desvanece — destaque suave.
    const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, 1)
    gradient.addColorStop(0, `rgba(${HIGHLIGHT_RGB}, 0.55)`)
    gradient.addColorStop(0.7, `rgba(${HIGHLIGHT_RGB}, 0.35)`)
    gradient.addColorStop(1, `rgba(${HIGHLIGHT_RGB}, 0)`)
    context.save()
    context.translate(cx, cy)
    context.scale(rx, ry)
    context.translate(-cx, -cy)
    context.fillStyle = gradient
    context.beginPath()
    context.arc(cx, cy, 1, 0, Math.PI * 2)
    context.fill()
    context.restore()
  }, [region, map, landmarks])

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
