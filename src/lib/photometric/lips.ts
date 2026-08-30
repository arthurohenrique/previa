/**
 * Bandas do lábio para o shader: `lip` (0..1, interior do vermelhão, para
 * saturação leve) e `edge` (0..1, banda da borda do vermelhão, para
 * definição de contorno).
 */

import { boxBlurFloat, gradient } from './luma'

export interface LipBands {
  lip: Float32Array
  edge: Float32Array
}

export function lipBands(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  edgeRadius: number,
): LipBands {
  const lip = new Float32Array(alpha.length)
  for (let i = 0; i < alpha.length; i++) lip[i] = alpha[i] / 255

  const smooth = boxBlurFloat(lip, width, height, edgeRadius)
  const gx = new Float32Array(alpha.length)
  const gy = new Float32Array(alpha.length)
  gradient(smooth, width, height, gx, gy)
  // Magnitude do gradiente normalizada: rampa de ~2·edgeRadius px → 1/(2r).
  const scale = 2 * Math.max(1, edgeRadius)
  const edge = new Float32Array(alpha.length)
  for (let i = 0; i < alpha.length; i++) {
    edge[i] = Math.min(1, Math.hypot(gx[i], gy[i]) * scale)
  }
  return { lip, edge }
}
