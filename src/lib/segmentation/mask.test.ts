import { describe, expect, it } from 'vitest'
import { boxBlurAlpha, classAlpha, smoothClassAlpha, type LabelMap } from './mask'

const map = (labels: number[], width: number, height: number): LabelMap => ({
  labels: new Uint8Array(labels),
  width,
  height,
})

describe('classAlpha', () => {
  it('marca 255 só nos pixels das classes pedidas', () => {
    const m = map([0, 1, 2, 1], 2, 2)
    expect(Array.from(classAlpha(m, [1]))).toEqual([0, 255, 0, 255])
    expect(Array.from(classAlpha(m, [1, 2]))).toEqual([0, 255, 255, 255])
    expect(Array.from(classAlpha(m, [9]))).toEqual([0, 0, 0, 0])
  })
})

describe('boxBlurAlpha', () => {
  it('radius 0 devolve cópia idêntica', () => {
    const alpha = new Uint8ClampedArray([0, 255, 0, 255])
    const out = boxBlurAlpha(alpha, 2, 2, 0)
    expect(Array.from(out)).toEqual([0, 255, 0, 255])
    expect(out).not.toBe(alpha)
  })

  it('interior de região sólida permanece 255 e exterior distante 0', () => {
    const w = 21
    const h = 21
    const alpha = new Uint8ClampedArray(w * h)
    for (let y = 5; y <= 15; y++)
      for (let x = 5; x <= 15; x++) alpha[y * w + x] = 255
    const out = boxBlurAlpha(alpha, w, h, 2)
    expect(out[10 * w + 10]).toBe(255) // centro
    expect(out[0]).toBe(0) // canto longe da região
  })

  it('cria rampa na borda (valores intermediários)', () => {
    const w = 20
    const h = 1
    const alpha = new Uint8ClampedArray(w)
    for (let x = 10; x < w; x++) alpha[x] = 255
    const out = boxBlurAlpha(alpha, w, h, 3)
    const edge = out[10]
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(255)
    // monotônica na transição
    expect(out[8]).toBeLessThanOrEqual(out[9])
    expect(out[9]).toBeLessThanOrEqual(out[10])
    expect(out[10]).toBeLessThanOrEqual(out[11])
  })

  it('preserva massa aproximada (blur não inventa nem some com pixels)', () => {
    const w = 16
    const h = 16
    const alpha = new Uint8ClampedArray(w * h)
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) alpha[y * w + x] = 255
    const before = alpha.reduce((a, b) => a + b, 0)
    const out = boxBlurAlpha(alpha, w, h, 2)
    const after = out.reduce((a, b) => a + b, 0)
    expect(Math.abs(after - before) / before).toBeLessThan(0.12)
  })
})

describe('smoothClassAlpha', () => {
  it('combina extração e suavização', () => {
    const m = map(
      Array.from({ length: 25 }, (_, i) => (i === 12 ? 1 : 0)),
      5,
      5,
    )
    const out = smoothClassAlpha(m, [1], 1)
    expect(out[12]).toBeGreaterThan(0)
    expect(out[0]).toBe(0)
  })
})
