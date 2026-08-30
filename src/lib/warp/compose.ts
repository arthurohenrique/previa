/**
 * Composição por frame: campo total = Σ intensidadeᵣ × campoᵣ, para a
 * geometria (2 canais) e a fotometria (4 canais). Como cada campo é linear
 * na intensidade, a soma ponderada é a única conta feita no arrasto do
 * slider — O(células), sem MLS.
 */

import type { RegionId } from '@/lib/anatomy'
import type { RegionField } from './field'

/** Intensidades por região (0..1). */
export type DeformMap = Partial<Record<RegionId, number>>

function accumulate(source: Float32Array, intensity: number, out: Float32Array): void {
  for (let i = 0; i < source.length; i++) {
    const value = source[i]
    if (value !== 0) out[i] += value * intensity
  }
}

export function composeFields(
  fields: ReadonlyMap<RegionId, RegionField>,
  intensities: DeformMap,
  outDisp: Float32Array,
  outPhoto: Float32Array,
): void {
  outDisp.fill(0)
  outPhoto.fill(0)
  for (const [region, field] of fields) {
    const intensity = intensities[region]
    if (intensity === undefined || intensity <= 0) continue
    if (field.disp.length !== outDisp.length || field.photo.length !== outPhoto.length) {
      throw new Error(`Campo de ${region} com dimensão diferente do buffer de composição.`)
    }
    accumulate(field.disp, intensity, outDisp)
    accumulate(field.photo, intensity, outPhoto)
  }
}
