import { describe, expect, it } from 'vitest'
import { boxBlurFloat, type LumaImage } from './luma'
import { LIFT_MAX_FRACTION, shadowLift } from './shadowLift'

const width = 80
const height = 80
const cx = 40
const cy = 40
const radius = 12

/** Pele 0.6 com disco escuro + textura senoidal de alta frequência. */
function scene(depth: number): { luma: LumaImage; mask: Float32Array } {
  const y = new Float32Array(width * height)
  const mask = new Float32Array(width * height)
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const inside = Math.hypot(i - cx, j - cy) < radius
      const texture = 0.03 * Math.sin(i * 1.7) * Math.cos(j * 1.3)
      y[j * width + i] = (inside ? 0.6 - depth : 0.6) + texture
      if (inside) mask[j * width + i] = 1
    }
  return { luma: { y, width, height }, mask }
}

function stats(values: Float32Array, mask: Float32Array) {
  let sum = 0
  let count = 0
  for (let i = 0; i < values.length; i++) if (mask[i] > 0) { sum += values[i]; count++ }
  const mean = sum / count
  let variance = 0
  for (let i = 0; i < values.length; i++) if (mask[i] > 0) variance += (values[i] - mean) ** 2
  return { mean, std: Math.sqrt(variance / count) }
}

describe('shadowLift', () => {
  it('sombra rasa: a média dentro da máscara converge à pele vizinha', () => {
    const { luma, mask } = scene(0.05)
    const lift = new Float32Array(width * height)
    shadowLift(luma, mask, 2, 6, 1, lift)
    const lifted = luma.y.map((value, i) => value + lift[i])
    expect(stats(lifted, mask).mean).toBeCloseTo(0.6, 1)
    expect(Math.abs(stats(lifted, mask).mean - 0.6)).toBeLessThan(0.02)
  })

  it('a textura de alta frequência é preservada (lift é suave)', () => {
    const { luma, mask } = scene(0.05)
    const lift = new Float32Array(width * height)
    shadowLift(luma, mask, 4, 10, 1, lift)
    const lifted = luma.y.map((value, i) => value + lift[i])
    const highBefore = luma.y.map((value, i) => value - boxBlurFloat(luma.y, width, height, 4)[i])
    const lowAfter = boxBlurFloat(lifted, width, height, 4)
    let worst = 0
    for (let j = cy - radius + 4; j < cy + radius - 4; j++)
      for (let i = cx - 6; i < cx + 6; i++) {
        const index = j * width + i
        worst = Math.max(worst, Math.abs(lifted[index] - lowAfter[index] - highBefore[index]))
      }
    expect(worst).toBeLessThan(0.01) // amplitude da textura é 0,03
  })

  it('nunca escurece, zero fora da máscara, respeita o teto', () => {
    const { luma, mask } = scene(0.3)
    const lift = new Float32Array(width * height)
    shadowLift(luma, mask, 2, 6, 1, lift)
    for (let i = 0; i < lift.length; i++) {
      expect(lift[i]).toBeGreaterThanOrEqual(0)
      if (mask[i] === 0) expect(lift[i]).toBe(0)
      expect(lift[i]).toBeLessThanOrEqual(LIFT_MAX_FRACTION * 0.65 + 1e-6)
    }
  })

  it('ganho zero não faz nada', () => {
    const { luma, mask } = scene(0.05)
    const lift = new Float32Array(width * height).fill(1)
    shadowLift(luma, mask, 2, 6, 0, lift)
    expect(lift.every((value) => value === 0)).toBe(true)
  })
})
