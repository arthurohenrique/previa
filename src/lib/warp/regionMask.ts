/**
 * Máscara alpha (0..255) da região, na resolução do labelmap: a forma onde
 * o procedimento atua. Lábios seguem a classe da segmentação; as demais
 * regiões são uma elipse suave ao redor dos landmarks que o template move.
 * Usada pela composição generativa e, na Fase C, como pseudo-altura.
 */

import type { RegionId } from '@/lib/anatomy'
import type { Point2 } from '@/lib/quality'
import { FACE_CLASSES, smoothClassAlpha, type LabelMap } from '@/lib/segmentation/mask'
import { buildFaceFrame } from './frame'
import { REGION_TEMPLATES } from './templates'

const MASK_BACKED: Partial<Record<RegionId, number[]>> = {
  'labio-superior': [FACE_CLASSES.u_lip],
  'labio-inferior': [FACE_CLASSES.l_lip],
}

/** Semieixos da elipse (× interocular). */
const ELLIPSE: Record<RegionId, { rx: number; ry: number }> = {
  'labio-superior': { rx: 0.4, ry: 0.15 },
  'labio-inferior': { rx: 0.4, ry: 0.15 },
  filtro: { rx: 0.12, ry: 0.15 },
  'malar-direito': { rx: 0.35, ry: 0.3 },
  'malar-esquerdo': { rx: 0.35, ry: 0.3 },
  mento: { rx: 0.35, ry: 0.3 },
  'sulco-nasogeniano-direito': { rx: 0.15, ry: 0.25 },
  'sulco-nasogeniano-esquerdo': { rx: 0.15, ry: 0.25 },
  'orbital-direita': { rx: 0.3, ry: 0.15 },
  'orbital-esquerda': { rx: 0.3, ry: 0.15 },
}

/** Atenuação C¹: 1 no centro, 0 (com derivada 0) em t = 1. */
export function falloff(t: number): number {
  if (t >= 1) return 0
  const s = 1 - t * t
  return s * s
}

export function regionAlpha(
  region: RegionId,
  landmarks: readonly Point2[],
  map: LabelMap,
): Uint8ClampedArray {
  const frame = buildFaceFrame(landmarks, map.width, map.height)
  const interocular = frame.scale

  const classes = MASK_BACKED[region]
  if (classes !== undefined) {
    return smoothClassAlpha(map, classes, Math.max(1, Math.round(interocular * 0.03)))
  }

  const specs = REGION_TEMPLATES[region].moving(landmarks, frame)
  let cx = 0
  let cy = 0
  for (const spec of specs) {
    cx += landmarks[spec.index].x * map.width
    cy += landmarks[spec.index].y * map.height
  }
  cx /= specs.length
  cy /= specs.length

  const { rx, ry } = ELLIPSE[region]
  const alpha = new Uint8ClampedArray(map.width * map.height)
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = Math.hypot((x - cx) / (rx * interocular), (y - cy) / (ry * interocular))
      const weight = falloff(t)
      if (weight > 0) alpha[y * map.width + x] = Math.round(weight * 255)
    }
  }
  return alpha
}
