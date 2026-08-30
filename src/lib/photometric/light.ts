/**
 * Direção de luz estimada da própria foto: a assimetria de luminância entre
 * as bochechas diz de que lado vem a luz; entre testa e mento, de cima ou de
 * baixo. Só pele conta (classe da máscara). Roda uma vez por foto.
 *
 * Convenção: vetor unitário apontando PARA a luz, em coordenadas da imagem
 * (x → direita, y → baixo, z → câmera). Luz frontal = (0, 0, 1).
 */

import type { Point2 } from '@/lib/quality'
import { FACE_CLASSES, type LabelMap } from '@/lib/segmentation/mask'
import type { LumaImage } from './luma'

export interface LightDirection {
  x: number
  y: number
  z: number
}

export const FRONTAL_LIGHT: LightDirection = { x: 0, y: 0, z: 1 }

/** Ganho da assimetria → componente lateral (ajustado para retratos comuns). */
const ASYMMETRY_GAIN = 3
const MAX_LATERAL = 0.7
/** Raio das janelas de amostragem (× interocular). */
const WINDOW_RADIUS = 0.12
/** Mínimo de pixels de pele na janela para a medida valer. */
const MIN_SAMPLES = 12

const CHEEK_RIGHT_PATIENT = 50 // imagem-esquerda
const CHEEK_LEFT_PATIENT = 280
const FOREHEAD = 151
const CHIN_UPPER = [199, 175] as const
const IRIS = [468, 473] as const

/** Luminância média da pele numa janela circular ao redor de `center` (UV). */
export function meanSkinLuma(
  luma: LumaImage,
  map: LabelMap,
  center: Point2,
  radiusPx: number,
): number | null {
  const cx = center.x * luma.width
  const cy = center.y * luma.height
  let sum = 0
  let count = 0
  const x0 = Math.max(0, Math.floor(cx - radiusPx))
  const x1 = Math.min(luma.width - 1, Math.ceil(cx + radiusPx))
  const y0 = Math.max(0, Math.floor(cy - radiusPx))
  const y1 = Math.min(luma.height - 1, Math.ceil(cy + radiusPx))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x - cx, y - cy) > radiusPx) continue
      const mx = Math.round((x / luma.width) * (map.width - 1))
      const my = Math.round((y / luma.height) * (map.height - 1))
      if (map.labels[my * map.width + mx] !== FACE_CLASSES.skin) continue
      sum += luma.y[y * luma.width + x]
      count++
    }
  }
  return count >= MIN_SAMPLES ? sum / count : null
}

function asymmetry(a: number | null, b: number | null): number {
  if (a === null || b === null || a + b < 1e-4) return 0
  const value = (ASYMMETRY_GAIN * (a - b)) / (a + b)
  return Math.min(MAX_LATERAL, Math.max(-MAX_LATERAL, value))
}

export function estimateLight(
  luma: LumaImage,
  map: LabelMap,
  landmarks: readonly Point2[],
): LightDirection {
  const interocularPx =
    Math.hypot(
      (landmarks[IRIS[1]].x - landmarks[IRIS[0]].x) * luma.width,
      (landmarks[IRIS[1]].y - landmarks[IRIS[0]].y) * luma.height,
    )
  const radius = Math.max(2, interocularPx * WINDOW_RADIUS)

  const left = meanSkinLuma(luma, map, landmarks[CHEEK_RIGHT_PATIENT], radius)
  const right = meanSkinLuma(luma, map, landmarks[CHEEK_LEFT_PATIENT], radius)
  const top = meanSkinLuma(luma, map, landmarks[FOREHEAD], radius)
  const chinCenter = {
    x: (landmarks[CHIN_UPPER[0]].x + landmarks[CHIN_UPPER[1]].x) / 2,
    y: (landmarks[CHIN_UPPER[0]].y + landmarks[CHIN_UPPER[1]].y) / 2,
  }
  const bottom = meanSkinLuma(luma, map, chinCenter, radius)

  // Lado mais claro = de onde vem a luz. Imagem-esquerda é x negativo;
  // cima é y negativo.
  const x = -asymmetry(left, right)
  const y = -asymmetry(top, bottom)
  const z = Math.sqrt(Math.max(0.5, 1 - x * x - y * y))
  const length = Math.hypot(x, y, z)
  return { x: x / length, y: y / length, z: z / length }
}
