/**
 * Shading determinístico do preenchimento — a pista de VOLUME.
 *
 * Warp geométrico sozinho lê-se como distorção: o cérebro espera que volume
 * novo mude a luz (realce no ápice, meia-sombra na base). Aqui geramos, por
 * região, um mapa de realce derivado das MESMAS fontes do campo de
 * deformação (máscara de classe ou elipse nos landmarks) — nenhum pixel é
 * inventado; é uma modulação de luminância proporcional à intensidade.
 *
 * Saída: RGBA branco com alpha = peso do realce (0..255), na resolução da
 * máscara. O componente desenha isso numa textura com blend "screen"
 * (clareia) e uma cópia deslocada para baixo com blend "multiply" leve
 * (meia-sombra), ambas escaladas pela intensidade do slider.
 */

import { centroid, interocularDistance } from '@/lib/anatomy'
import type { RegionId } from '@/lib/anatomy'
import type { Point2 } from '@/lib/quality'
import { smoothClassAlpha, type LabelMap } from '@/lib/segmentation/mask'
import { falloff, REGION_DEFORM } from './field'

export interface ShadingSource {
  /** RGBA intercalado, branco com alpha = peso do realce. */
  pixels: Uint8ClampedArray
  width: number
  height: number
  /** Fator máximo de realce recomendado para a região (0..1). */
  strength: number
}

/** Realce máximo por tipo de região. */
const LIP_STRENGTH = 0.3
const AREA_STRENGTH = 0.18

export function buildShadingSource(
  region: RegionId,
  landmarks: readonly Point2[],
  map: LabelMap,
): ShadingSource {
  const params = REGION_DEFORM[region]
  const pixels = new Uint8ClampedArray(map.width * map.height * 4)

  const scaleUv = interocularDistance(landmarks)
  const mapScalePx = (scaleUv * (map.width + map.height)) / 2

  if (params.kind === 'line-scale') {
    // Lábios: o realce segue a forma real do vermelhão (alpha suavizado).
    const blur = Math.max(2, Math.round(mapScalePx * 0.04))
    const alpha = smoothClassAlpha(map, params.maskClasses, blur)
    for (let i = 0; i < alpha.length; i++) {
      const offset = i * 4
      pixels[offset] = 255
      pixels[offset + 1] = 255
      pixels[offset + 2] = 255
      pixels[offset + 3] = alpha[i]
    }
    return { pixels, width: map.width, height: map.height, strength: LIP_STRENGTH }
  }

  // Regiões difusas: elipse com a MESMA atenuação C¹ do campo de deformação.
  const center = centroid(landmarks, params.centerIndices)
  const cx = center.x * map.width
  const cy = center.y * map.height
  const rx = params.radiusFactor * mapScalePx
  const ry = rx * params.aspect

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = Math.hypot((x - cx) / rx, (y - cy) / ry)
      const weight = falloff(t)
      if (weight === 0) continue
      const offset = (y * map.width + x) * 4
      pixels[offset] = 255
      pixels[offset + 1] = 255
      pixels[offset + 2] = 255
      pixels[offset + 3] = Math.round(weight * 255)
    }
  }
  return { pixels, width: map.width, height: map.height, strength: AREA_STRENGTH }
}
