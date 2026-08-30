/**
 * Sombreamento do volume novo: uma pseudo-altura h (0..1) com a forma da
 * região, iluminada por um lambertiano LINEARIZADO — realce no flanco
 * voltado à luz, meia-sombra no oposto, zero no platô e fora da região.
 *
 * n ≈ (−s·∂h/∂x, −s·∂h/∂y, 1) → n·L − L_z ≈ −s·(h_x·L_x + h_y·L_y).
 * É linear na altura, logo linear na intensidade do slider.
 */

import { boxBlurFloat, gradient } from './luma'
import type { LightDirection } from './light'

/** Limites do ganho de luminância multiplicativo (fração). */
export const SHADE_MIN = -0.12
export const SHADE_MAX = 0.15

/** Alpha 0..255 da região → altura 0..1 arredondada por blur. */
export function heightMap(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  blurRadius: number,
): Float32Array {
  const base = new Float32Array(alpha.length)
  for (let i = 0; i < alpha.length; i++) base[i] = alpha[i] / 255
  return boxBlurFloat(base, width, height, blurRadius)
}

/**
 * `slope` converte o gradiente (por pixel) em inclinação da superfície: com
 * slope = largura da rampa em px, a borda da região tem inclinação ~1.
 * `gain` é o realce máximo da região (0..1). Escreve em `out`.
 */
export function lambertShade(
  height: Float32Array,
  width: number,
  rows: number,
  light: LightDirection,
  slope: number,
  gain: number,
  out: Float32Array,
): void {
  const gx = new Float32Array(height.length)
  const gy = new Float32Array(height.length)
  gradient(height, width, rows, gx, gy)
  for (let i = 0; i < height.length; i++) {
    const value = -slope * (gx[i] * light.x + gy[i] * light.y) * gain
    out[i] = Math.min(SHADE_MAX, Math.max(SHADE_MIN, value))
  }
}
