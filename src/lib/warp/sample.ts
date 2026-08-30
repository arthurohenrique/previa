/**
 * Amostragem bilinear de buffers 2D em coordenadas UV (0..1) — usada pelo
 * campo de deslocamento e pelas máscaras alpha.
 */

import type { Point2 } from '@/lib/quality'

interface BilinearCell {
  index00: number
  index10: number
  index01: number
  index11: number
  fx: number
  fy: number
}

function locate(width: number, height: number, u: number, v: number): BilinearCell {
  const x = Math.min(width - 1.001, Math.max(0, u * (width - 1)))
  const y = Math.min(height - 1.001, Math.max(0, v * (height - 1)))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const index00 = y0 * width + x0
  return {
    index00,
    index10: index00 + 1,
    index01: index00 + width,
    index11: index00 + width + 1,
    fx: x - x0,
    fy: y - y0,
  }
}

/** Alpha 0..255 de um canal → 0..1 interpolado. */
export function sampleAlpha(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  u: number,
  v: number,
): number {
  const cell = locate(width, height, u, v)
  const top = alpha[cell.index00] * (1 - cell.fx) + alpha[cell.index10] * cell.fx
  const bottom = alpha[cell.index01] * (1 - cell.fx) + alpha[cell.index11] * cell.fx
  return (top * (1 - cell.fy) + bottom * cell.fy) / 255
}

/** Campo intercalado [dx, dy, …] → vetor interpolado (mesmas unidades do campo). */
export function sampleField(
  field: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number,
  out: Point2,
): void {
  const cell = locate(width, height, u, v)
  const w00 = (1 - cell.fx) * (1 - cell.fy)
  const w10 = cell.fx * (1 - cell.fy)
  const w01 = (1 - cell.fx) * cell.fy
  const w11 = cell.fx * cell.fy
  out.x =
    field[cell.index00 * 2] * w00 +
    field[cell.index10 * 2] * w10 +
    field[cell.index01 * 2] * w01 +
    field[cell.index11 * 2] * w11
  out.y =
    field[cell.index00 * 2 + 1] * w00 +
    field[cell.index10 * 2 + 1] * w10 +
    field[cell.index01 * 2 + 1] * w01 +
    field[cell.index11 * 2 + 1] * w11
}
