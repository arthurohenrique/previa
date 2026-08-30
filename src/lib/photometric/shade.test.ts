import { describe, expect, it } from 'vitest'
import { heightMap, lambertShade, SHADE_MAX, SHADE_MIN } from './shade'

const width = 64
const rows = 64
const cx = 32
const cy = 32
const radius = 20

/** Paraboloide: 1 no centro, 0 no raio. */
function paraboloid(): Float32Array {
  const h = new Float32Array(width * rows)
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < width; x++) {
      const t = Math.hypot(x - cx, y - cy) / radius
      h[y * width + x] = t < 1 ? 1 - t * t : 0
    }
  return h
}

describe('lambertShade', () => {
  const shade = new Float32Array(width * rows)
  lambertShade(paraboloid(), width, rows, { x: -0.5, y: 0, z: 0.87 }, radius, 1, shade)
  const at = (x: number, y: number) => shade[y * width + x]

  it('flanco voltado à luz clareia, oposto escurece, ápice ~0', () => {
    expect(at(cx - 12, cy)).toBeGreaterThan(0.02)
    expect(at(cx + 12, cy)).toBeLessThan(-0.02)
    expect(Math.abs(at(cx, cy))).toBeLessThan(1e-3)
    expect(Math.abs(at(0, 0))).toBe(0)
  })

  it('respeita os limites; sem clamp a média numa forma simétrica é ~0', () => {
    for (const value of shade) {
      expect(value).toBeLessThanOrEqual(SHADE_MAX + 1e-6)
      expect(value).toBeGreaterThanOrEqual(SHADE_MIN - 1e-6)
    }
    const soft = new Float32Array(width * rows)
    lambertShade(paraboloid(), width, rows, { x: -0.5, y: 0, z: 0.87 }, radius, 0.2, soft)
    let sum = 0
    for (const value of soft) sum += value
    expect(Math.abs(sum / soft.length)).toBeLessThan(1e-3)
  })

  it('luz de cima realça a borda superior', () => {
    const top = new Float32Array(width * rows)
    lambertShade(paraboloid(), width, rows, { x: 0, y: -0.6, z: 0.8 }, radius, 1, top)
    expect(top[(cy - 12) * width + cx]).toBeGreaterThan(0.02)
    expect(top[(cy + 12) * width + cx]).toBeLessThan(-0.02)
  })

  it('é linear no ganho abaixo do teto', () => {
    const low = new Float32Array(width * rows)
    const half = new Float32Array(width * rows)
    lambertShade(paraboloid(), width, rows, { x: -0.5, y: 0, z: 0.87 }, radius, 0.2, low)
    lambertShade(paraboloid(), width, rows, { x: -0.5, y: 0, z: 0.87 }, radius, 0.1, half)
    expect(low[cy * width + cx - 12]).toBeLessThan(SHADE_MAX)
    expect(half[cy * width + cx - 12]).toBeCloseTo(low[cy * width + cx - 12] / 2)
  })
})

describe('heightMap', () => {
  it('alpha 255 vira 1, borda arredondada pelo blur', () => {
    const alpha = new Uint8ClampedArray(9 * 9)
    for (let y = 2; y < 7; y++) for (let x = 2; x < 7; x++) alpha[y * 9 + x] = 255
    const h = heightMap(alpha, 9, 9, 1)
    expect(h[4 * 9 + 4]).toBeCloseTo(1)
    expect(h[4 * 9 + 1]).toBeGreaterThan(0)
    expect(h[4 * 9 + 1]).toBeLessThan(1)
  })
})
